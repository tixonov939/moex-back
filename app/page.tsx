"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  type TooltipProps,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import styles from "./page.module.css";

type SearchResult = {
  ticker: string;
  name: string;
};

type BacktestPoint = {
  date: string;
  stock: number;
  imoex: number;
  stockValue: number;
  imoexValue: number;
  comparison?: number;
  comparisonValue?: number;
};

type BacktestResult = {
  initialAmount: number;
  finalAmount: number;
  dividendIncome: number;
  profitLoss: number;
  returnPercent: number;
  startDate: string;
  endDate: string;
  points: BacktestPoint[];
};

type TopPeriod = "1y" | "3y" | "5y";

type TopStockItem = {
  ticker: string;
  shortname: string;
  currentPrice: number;
  returnPct: number;
  sparkline: number[];
};

type TopStocksResult = {
  updatedAt: string;
  items: TopStockItem[];
};

type DropdownPosition = {
  top: number;
  left: number;
  width: number;
};

function formatRubles(value: number) {
  return `${value.toLocaleString("ru-RU")} ₽`;
}

function formatSignedRubles(value: number) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toLocaleString("ru-RU")} ₽`;
}

function formatSignedPercent(value: number) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toLocaleString("ru-RU")} %`;
}

function formatPercent(value: number) {
  return `${value.toLocaleString("ru-RU")} %`;
}

function formatAmountInput(value: string) {
  const digits = value.replace(/\D/g, "");

  if (!digits) {
    return { raw: "", formatted: "" };
  }

  const raw = String(Number(digits));
  const formatted = Number(raw).toLocaleString("ru-RU").replace(/ /g, "\u00A0");
  return { raw, formatted };
}

function formatDateLabel(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("ru-RU");
}

function getMiniBarHeights(values: number[]) {
  if (!values.length) {
    return [];
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  return values.map((value) => 18 + ((value - min) / range) * 30);
}

function getLaterDate(firstDate: string, secondDate: string) {
  if (!firstDate) {
    return secondDate;
  }

  if (!secondDate) {
    return firstDate;
  }

  return firstDate > secondDate ? firstDate : secondDate;
}

function mergeComparisonPoints(primaryPoints: BacktestPoint[], comparisonPoints: BacktestPoint[]) {
  const comparisonMap = new Map(comparisonPoints.map((point) => [point.date, point]));

  return primaryPoints.map((point) => {
    const comparisonPoint = comparisonMap.get(point.date);

    return {
      ...point,
      comparison: comparisonPoint?.stock,
      comparisonValue: comparisonPoint?.stockValue
    };
  });
}

function ChartTooltip({ active, payload, label }: TooltipProps<ValueType, NameType>) {
  if (!active || !payload?.length || typeof label !== "string") {
    return null;
  }

  const point = payload[0]?.payload as BacktestPoint | undefined;

  if (!point) {
    return null;
  }

  return (
    <div
      style={{
        border: "1px solid #d1d5db",
        background: "#ffffff",
        padding: "12px"
      }}
    >
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>{formatDateLabel(label)}</div>
      {payload.map((entry) => {
        const dataKey = String(entry.dataKey);
        const normalizedValue = typeof entry.value === "number" ? entry.value : Number(entry.value);
        const actualValue =
          dataKey === "stock"
            ? point.stockValue
            : dataKey === "comparison"
              ? point.comparisonValue
              : point.imoexValue;

        if (Number.isNaN(normalizedValue) || typeof actualValue !== "number") {
          return null;
        }

        return (
          <div key={dataKey} style={{ fontSize: 13 }}>
            {entry.name}: {normalizedValue.toLocaleString("ru-RU")} ({formatRubles(actualValue)})
          </div>
        );
      })}
    </div>
  );
}

export default function HomePage() {
  const primarySearchTimeoutRef = useRef<number | null>(null);
  const comparisonSearchTimeoutRef = useRef<number | null>(null);
  const primaryBlurTimeoutRef = useRef<number | null>(null);
  const comparisonBlurTimeoutRef = useRef<number | null>(null);
  const primaryInputRef = useRef<HTMLInputElement | null>(null);
  const comparisonInputRef = useRef<HTMLInputElement | null>(null);

  const [query, setQuery] = useState("");
  const [comparisonQuery, setComparisonQuery] = useState("");
  const [selectedStock, setSelectedStock] = useState<SearchResult | null>(null);
  const [comparisonStock, setComparisonStock] = useState<SearchResult | null>(null);
  const [activeTab, setActiveTab] = useState<"calculator" | "top">("calculator");
  const [topPeriod, setTopPeriod] = useState<TopPeriod>("3y");
  const [topData, setTopData] = useState<TopStocksResult | null>(null);
  const [topError, setTopError] = useState("");
  const [isTopLoading, setIsTopLoading] = useState(false);

  const [primarySearchResults, setPrimarySearchResults] = useState<SearchResult[]>([]);
  const [comparisonSearchResults, setComparisonSearchResults] = useState<SearchResult[]>([]);
  const [isPrimaryDropdownOpen, setIsPrimaryDropdownOpen] = useState(false);
  const [isComparisonDropdownOpen, setIsComparisonDropdownOpen] = useState(false);
  const [isPrimarySearching, setIsPrimarySearching] = useState(false);
  const [isComparisonSearching, setIsComparisonSearching] = useState(false);
  const [primarySearchError, setPrimarySearchError] = useState("");
  const [comparisonSearchError, setComparisonSearchError] = useState("");

  const [amountInput, setAmountInput] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [purchaseDate, setPurchaseDate] = useState("");
  const [primaryMinTradeDate, setPrimaryMinTradeDate] = useState("");
  const [comparisonMinTradeDate, setComparisonMinTradeDate] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [comparisonResult, setComparisonResult] = useState<BacktestResult | null>(null);
  const [portalReady, setPortalReady] = useState(false);
  const [primaryDropdownPosition, setPrimaryDropdownPosition] = useState<DropdownPosition | null>(null);
  const [comparisonDropdownPosition, setComparisonDropdownPosition] = useState<DropdownPosition | null>(null);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    function updatePrimaryDropdownPosition() {
      if (!primaryInputRef.current) {
        return;
      }

      const rect = primaryInputRef.current.getBoundingClientRect();
      setPrimaryDropdownPosition({
        top: rect.bottom + 8,
        left: rect.left,
        width: rect.width
      });
    }

    if (!isPrimaryDropdownOpen) {
      return;
    }

    updatePrimaryDropdownPosition();
    window.addEventListener("resize", updatePrimaryDropdownPosition);
    window.addEventListener("scroll", updatePrimaryDropdownPosition, true);

    return () => {
      window.removeEventListener("resize", updatePrimaryDropdownPosition);
      window.removeEventListener("scroll", updatePrimaryDropdownPosition, true);
    };
  }, [isPrimaryDropdownOpen, primarySearchResults.length, isPrimarySearching, primarySearchError]);

  useEffect(() => {
    function updateComparisonDropdownPosition() {
      if (!comparisonInputRef.current) {
        return;
      }

      const rect = comparisonInputRef.current.getBoundingClientRect();
      setComparisonDropdownPosition({
        top: rect.bottom + 8,
        left: rect.left,
        width: rect.width
      });
    }

    if (!isComparisonDropdownOpen) {
      return;
    }

    updateComparisonDropdownPosition();
    window.addEventListener("resize", updateComparisonDropdownPosition);
    window.addEventListener("scroll", updateComparisonDropdownPosition, true);

    return () => {
      window.removeEventListener("resize", updateComparisonDropdownPosition);
      window.removeEventListener("scroll", updateComparisonDropdownPosition, true);
    };
  }, [isComparisonDropdownOpen, comparisonSearchResults.length, isComparisonSearching, comparisonSearchError]);

  useEffect(() => {
    if (!query.trim() || query.trim().length < 2 || selectedStock?.ticker === query.trim().toUpperCase()) {
      setPrimarySearchResults([]);
      setPrimarySearchError("");
      return;
    }

    if (primarySearchTimeoutRef.current) {
      window.clearTimeout(primarySearchTimeoutRef.current);
    }

    primarySearchTimeoutRef.current = window.setTimeout(async () => {
      try {
        setIsPrimarySearching(true);
        setPrimarySearchError("");
        const response = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
        const payload = (await response.json()) as { results?: SearchResult[]; error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Не удалось выполнить поиск.");
        }

        setPrimarySearchResults(payload.results ?? []);
        setIsPrimaryDropdownOpen(true);
      } catch (requestError) {
        setPrimarySearchResults([]);
        setPrimarySearchError(
          requestError instanceof Error ? requestError.message : "Не удалось выполнить поиск."
        );
      } finally {
        setIsPrimarySearching(false);
      }
    }, 250);

    return () => {
      if (primarySearchTimeoutRef.current) {
        window.clearTimeout(primarySearchTimeoutRef.current);
      }
    };
  }, [query, selectedStock]);

  useEffect(() => {
    if (
      !comparisonQuery.trim() ||
      comparisonQuery.trim().length < 2 ||
      comparisonStock?.ticker === comparisonQuery.trim().toUpperCase()
    ) {
      setComparisonSearchResults([]);
      setComparisonSearchError("");
      return;
    }

    if (comparisonSearchTimeoutRef.current) {
      window.clearTimeout(comparisonSearchTimeoutRef.current);
    }

    comparisonSearchTimeoutRef.current = window.setTimeout(async () => {
      try {
        setIsComparisonSearching(true);
        setComparisonSearchError("");
        const response = await fetch(`/api/search?q=${encodeURIComponent(comparisonQuery.trim())}`);
        const payload = (await response.json()) as { results?: SearchResult[]; error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Не удалось выполнить поиск.");
        }

        setComparisonSearchResults(payload.results ?? []);
        setIsComparisonDropdownOpen(true);
      } catch (requestError) {
        setComparisonSearchResults([]);
        setComparisonSearchError(
          requestError instanceof Error ? requestError.message : "Не удалось выполнить поиск."
        );
      } finally {
        setIsComparisonSearching(false);
      }
    }, 250);

    return () => {
      if (comparisonSearchTimeoutRef.current) {
        window.clearTimeout(comparisonSearchTimeoutRef.current);
      }
    };
  }, [comparisonQuery, comparisonStock]);

  useEffect(() => {
    return () => {
      if (primaryBlurTimeoutRef.current) {
        window.clearTimeout(primaryBlurTimeoutRef.current);
      }

      if (comparisonBlurTimeoutRef.current) {
        window.clearTimeout(comparisonBlurTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (activeTab !== "top") {
      return;
    }

    let isCancelled = false;

    async function loadTopStocks() {
      try {
        setIsTopLoading(true);
        setTopError("");

        const response = await fetch(`/api/top?period=${topPeriod}`);
        const payload = (await response.json()) as TopStocksResult & { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Не удалось загрузить данные, попробуйте позже");
        }

        if (!isCancelled) {
          setTopData(payload);
        }
      } catch (requestError) {
        if (!isCancelled) {
          setTopError(
            requestError instanceof Error
              ? requestError.message
              : "Не удалось загрузить данные, попробуйте позже"
          );
        }
      } finally {
        if (!isCancelled) {
          setIsTopLoading(false);
        }
      }
    }

    void loadTopStocks();

    return () => {
      isCancelled = true;
    };
  }, [activeTab, topPeriod]);

  const minPurchaseDate = useMemo(
    () => getLaterDate(primaryMinTradeDate, comparisonMinTradeDate),
    [primaryMinTradeDate, comparisonMinTradeDate]
  );

  useEffect(() => {
    if (!minPurchaseDate) {
      return;
    }

    setPurchaseDate((currentValue) => {
      if (!currentValue || currentValue < minPurchaseDate) {
        return minPurchaseDate;
      }

      return currentValue;
    });
  }, [minPurchaseDate]);

  const isFormValid = Boolean(selectedStock && purchaseDate && amount && amount > 0);
  const comparisonMode = Boolean(result && comparisonStock && comparisonResult);

  const returnClassName = useMemo(() => {
    if (!result) {
      return "";
    }

    return result.returnPercent >= 0 ? styles.positive : styles.negative;
  }, [result]);

  const comparisonChartData = useMemo(() => {
    if (!result) {
      return [];
    }

    if (!comparisonResult) {
      return result.points;
    }

    return mergeComparisonPoints(result.points, comparisonResult.points);
  }, [result, comparisonResult]);

  const winner = useMemo(() => {
    if (!comparisonMode || !result || !comparisonResult) {
      return null;
    }

    if (result.finalAmount === comparisonResult.finalAmount) {
      return null;
    }

    return result.finalAmount > comparisonResult.finalAmount ? "primary" : "comparison";
  }, [comparisonMode, result, comparisonResult]);

  const verdict = useMemo(() => {
    if (!comparisonMode || !result || !comparisonResult || !selectedStock || !comparisonStock) {
      return null;
    }

    if (result.finalAmount === comparisonResult.finalAmount) {
      return {
        text: `${selectedStock.ticker} и ${comparisonStock.ticker} показали одинаковый результат`
      };
    }

    const primaryWon = result.finalAmount > comparisonResult.finalAmount;
    const winnerStock = primaryWon ? selectedStock : comparisonStock;
    const loserStock = primaryWon ? comparisonStock : selectedStock;
    const percentDifference = Math.abs(result.returnPercent - comparisonResult.returnPercent);
    const amountDifference = Math.abs(result.finalAmount - comparisonResult.finalAmount);

    return {
      winnerTicker: winnerStock.ticker,
      loserTicker: loserStock.ticker,
      percentDifference: `+${percentDifference.toLocaleString("ru-RU")} %`,
      amountDifference: `+${amountDifference.toLocaleString("ru-RU")} ₽`
    };
  }, [comparisonMode, comparisonResult, comparisonStock, result, selectedStock]);

  async function fetchFirstTradeDate(ticker: string) {
    const response = await fetch(`/api/first-trade/${ticker}`);
    const payload = (await response.json()) as { firstTradeDate?: string; error?: string };

    if (!response.ok || !payload.firstTradeDate) {
      throw new Error(payload.error ?? "Не удалось определить дату начала торгов.");
    }

    return payload.firstTradeDate;
  }

  async function handleSelectStock(stock: SearchResult) {
    setSelectedStock(stock);
    setQuery(stock.ticker);
    setPrimarySearchResults([]);
    setIsPrimaryDropdownOpen(false);
    setPrimarySearchError("");
    setError("");
    setResult(null);
    setComparisonResult(null);

    try {
      const firstTradeDate = await fetchFirstTradeDate(stock.ticker);
      setPrimaryMinTradeDate(firstTradeDate);
    } catch (requestError) {
      setPrimaryMinTradeDate("");
      setPurchaseDate("");
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось определить дату начала торгов."
      );
    }
  }

  async function handleSelectComparisonStock(stock: SearchResult) {
    setComparisonStock(stock);
    setComparisonQuery(stock.ticker);
    setComparisonSearchResults([]);
    setIsComparisonDropdownOpen(false);
    setComparisonSearchError("");
    setError("");
    setComparisonResult(null);

    try {
      const firstTradeDate = await fetchFirstTradeDate(stock.ticker);
      setComparisonMinTradeDate(firstTradeDate);
    } catch (requestError) {
      setComparisonMinTradeDate("");
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось определить дату начала торгов."
      );
    }
  }

  async function handleCalculate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedStock || !purchaseDate || !amount) {
      setError("Заполните все поля формы.");
      return;
    }

    try {
      setIsLoading(true);
      setError("");

      const primaryRequest = fetch("/api/backtest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ticker: selectedStock.ticker,
          purchaseDate,
          amount
        })
      });

      const comparisonRequest = comparisonStock
        ? fetch("/api/backtest", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              ticker: comparisonStock.ticker,
              purchaseDate,
              amount
            })
          })
        : null;

      const [primaryResponse, comparisonResponse] = await Promise.all([
        primaryRequest,
        comparisonRequest
      ]);

      const primaryPayload = (await primaryResponse.json()) as BacktestResult & { error?: string };

      if (!primaryResponse.ok) {
        throw new Error(primaryPayload.error ?? "Не удалось выполнить расчет.");
      }

      let comparisonPayload: BacktestResult | null = null;

      if (comparisonResponse) {
        const parsedComparisonPayload = (await comparisonResponse.json()) as BacktestResult & {
          error?: string;
        };

        if (!comparisonResponse.ok) {
          throw new Error(parsedComparisonPayload.error ?? "Не удалось выполнить расчет.");
        }

        comparisonPayload = parsedComparisonPayload;
      }

      setResult(primaryPayload);
      setComparisonResult(comparisonPayload);
    } catch (requestError) {
      setResult(null);
      setComparisonResult(null);
      setError(
        requestError instanceof Error ? requestError.message : "Не удалось выполнить расчет."
      );
    } finally {
      setIsLoading(false);
    }
  }

  function renderDropdown({
    isOpen,
    position,
    results,
    isSearching,
    searchError,
    onSelect
  }: {
    isOpen: boolean;
    position: DropdownPosition | null;
    results: SearchResult[];
    isSearching: boolean;
    searchError: string;
    onSelect: (stock: SearchResult) => void;
  }) {
    if (!portalReady || !position || !isOpen || (!results.length && !isSearching && !searchError)) {
      return null;
    }

    return createPortal(
      <div
        className={styles.dropdownPortal}
        style={{
          top: position.top,
          left: position.left,
          width: position.width
        }}
      >
        <div className={styles.dropdown}>
          {isSearching ? <div className={styles.dropdownItem}>Ищем бумаги...</div> : null}
          {!isSearching && searchError ? (
            <div className={styles.dropdownItem}>{searchError}</div>
          ) : null}
          {!isSearching &&
            !searchError &&
            results.map((stock) => (
              <button
                key={`${stock.ticker}-${stock.name}`}
                type="button"
                className={styles.dropdownItem}
                onMouseDown={() => {
                  onSelect(stock);
                }}
              >
                <span className={styles.dropdownTicker}>{stock.ticker}</span>
                <span className={styles.dropdownName}>{stock.name}</span>
              </button>
            ))}
        </div>
      </div>,
      document.body
    );
  }

  function handleTopStockClick(stock: TopStockItem) {
    setActiveTab("calculator");
    void handleSelectStock({
      ticker: stock.ticker,
      name: stock.shortname
    });
  }

  function renderTopStocks() {
    const skeletonRows = Array.from({ length: 8 }, (_, index) => index);

    return (
      <section className={styles.topSection}>
        <div className={styles.topHeader}>
          <h2 className={styles.topTitle}>Лучшие акции Мосбиржи</h2>
          <div className={styles.periodTabs}>
            {[
              { value: "1y" as const, label: "1 год" },
              { value: "3y" as const, label: "3 года" },
              { value: "5y" as const, label: "5 лет" }
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                className={`${styles.periodPill} ${topPeriod === option.value ? styles.periodPillActive : ""}`}
                onClick={() => {
                  setTopPeriod(option.value);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className={styles.topUpdated}>
            обновлено сегодня в {topData?.updatedAt ?? "—:—"}
          </div>
        </div>

        <div className={styles.topTableWrap}>
          {topError ? (
            <div className={`${styles.status} ${styles.statusError}`}>
              Не удалось загрузить данные, попробуйте позже
            </div>
          ) : (
            <table className={styles.topTable}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>акция</th>
                  <th>цена</th>
                  <th>доходность</th>
                  <th>динамика</th>
                </tr>
              </thead>
              <tbody>
                {isTopLoading
                  ? skeletonRows.map((row) => (
                      <tr key={row} className={styles.skeletonRow}>
                        <td>
                          <div className={styles.skeletonBlock} />
                        </td>
                        <td>
                          <div className={styles.skeletonBlock} />
                        </td>
                        <td>
                          <div className={styles.skeletonBlock} />
                        </td>
                        <td>
                          <div className={styles.skeletonBlock} />
                        </td>
                        <td>
                          <div className={styles.skeletonBars}>
                            {Array.from({ length: 8 }, (_, barIndex) => (
                              <span key={barIndex} className={styles.skeletonBar} />
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))
                  : topData?.items.map((item, index) => {
                      const heights = getMiniBarHeights(item.sparkline);
                      const isPositive = item.returnPct >= 0;

                      return (
                        <tr
                          key={item.ticker}
                          className={styles.topRow}
                          onClick={() => {
                            handleTopStockClick(item);
                          }}
                        >
                          <td
                            className={`${styles.rankCell} ${index < 3 ? styles.rankCellTop : ""}`}
                          >
                            {index + 1}
                          </td>
                          <td>
                            <div className={styles.topStockCell}>
                              <span className={styles.topTicker}>{item.ticker}</span>
                              <span className={styles.topName}>{item.shortname}</span>
                            </div>
                          </td>
                          <td>{formatRubles(item.currentPrice)}</td>
                          <td className={isPositive ? styles.topPositive : styles.topNegative}>
                            {formatPercent(item.returnPct)}
                          </td>
                          <td>
                            <div className={styles.sparkline} aria-hidden="true">
                              {heights.map((height, barIndex) => (
                                <span
                                  key={`${item.ticker}-${barIndex}`}
                                  className={`${styles.sparkBar} ${
                                    isPositive ? styles.sparkBarPositive : styles.sparkBarNegative
                                  }`}
                                  style={{ height }}
                                />
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <h1 className={styles.logo}>moex.back</h1>
          <p className={styles.subtitle}>считай доходность акций Мосбиржи</p>
        </div>
      </header>

      <div className={styles.tabsWrap}>
        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tabButton} ${activeTab === "calculator" ? styles.tabButtonActive : ""}`}
            onClick={() => {
              setActiveTab("calculator");
            }}
          >
            Калькулятор
          </button>
          <button
            type="button"
            className={`${styles.tabButton} ${activeTab === "top" ? styles.tabButtonActive : ""}`}
            onClick={() => {
              setActiveTab("top");
            }}
          >
            Топ акций
          </button>
        </div>
      </div>

      <main className={styles.main}>
        {activeTab === "calculator" ? (
          <>
        <div className={styles.formWrap}>
          <form className={styles.form} onSubmit={handleCalculate}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="stock-search">
                Акция
              </label>
              <input
                id="stock-search"
                className={styles.input}
                type="text"
                ref={primaryInputRef}
                value={query}
                placeholder="Например, SBER или Лукойл"
                autoComplete="off"
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setQuery(nextValue);
                  setSelectedStock(null);
                  setPrimaryMinTradeDate("");
                  setPurchaseDate("");
                  setResult(null);
                  setComparisonResult(null);
                  setError("");
                  setPrimarySearchError("");
                  if (nextValue.trim().length >= 2) {
                    setIsPrimaryDropdownOpen(true);
                    setIsComparisonDropdownOpen(false);
                  } else {
                    setIsPrimaryDropdownOpen(false);
                    setPrimarySearchResults([]);
                  }
                }}
                onFocus={() => {
                  if (primaryInputRef.current) {
                    const rect = primaryInputRef.current.getBoundingClientRect();
                    setPrimaryDropdownPosition({
                      top: rect.bottom + 8,
                      left: rect.left,
                      width: rect.width
                    });
                  }

                  setIsComparisonDropdownOpen(false);

                  if (primarySearchResults.length > 0 || (query.trim().length >= 2 && primarySearchError)) {
                    setIsPrimaryDropdownOpen(true);
                  }
                }}
                onBlur={() => {
                  primaryBlurTimeoutRef.current = window.setTimeout(() => {
                    setIsPrimaryDropdownOpen(false);
                  }, 150);
                }}
              />
              <div className={styles.searchHint}>
                {selectedStock && primaryMinTradeDate
                  ? `Минимальная дата покупки: ${formatDateLabel(primaryMinTradeDate)}`
                  : "Начните вводить тикер или название компании"}
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="comparison-stock-search">
                Сравнить с (необязательно)
              </label>
              <input
                id="comparison-stock-search"
                className={styles.input}
                type="text"
                ref={comparisonInputRef}
                value={comparisonQuery}
                placeholder="Например, GAZP или Яндекс"
                autoComplete="off"
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setComparisonQuery(nextValue);
                  setComparisonStock(null);
                  setComparisonMinTradeDate("");
                  setComparisonResult(null);
                  setError("");
                  setComparisonSearchError("");

                  if (!nextValue.trim()) {
                    setIsComparisonDropdownOpen(false);
                    setComparisonSearchResults([]);
                  } else if (nextValue.trim().length >= 2) {
                    setIsComparisonDropdownOpen(true);
                    setIsPrimaryDropdownOpen(false);
                  } else {
                    setIsComparisonDropdownOpen(false);
                    setComparisonSearchResults([]);
                  }
                }}
                onFocus={() => {
                  if (comparisonInputRef.current) {
                    const rect = comparisonInputRef.current.getBoundingClientRect();
                    setComparisonDropdownPosition({
                      top: rect.bottom + 8,
                      left: rect.left,
                      width: rect.width
                    });
                  }

                  setIsPrimaryDropdownOpen(false);

                  if (
                    comparisonSearchResults.length > 0 ||
                    (comparisonQuery.trim().length >= 2 && comparisonSearchError)
                  ) {
                    setIsComparisonDropdownOpen(true);
                  }
                }}
                onBlur={() => {
                  comparisonBlurTimeoutRef.current = window.setTimeout(() => {
                    setIsComparisonDropdownOpen(false);
                  }, 150);
                }}
              />
              <div className={styles.searchHint}>
                {comparisonStock && comparisonMinTradeDate
                  ? `Минимальная дата покупки: ${formatDateLabel(comparisonMinTradeDate)}`
                  : "Можно оставить пустым"}
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="amount">
                Сумма инвестиций, ₽
              </label>
              <input
                id="amount"
                className={styles.input}
                type="text"
                inputMode="numeric"
                placeholder="100 000"
                value={amountInput}
                onChange={(event) => {
                  const nextValue = formatAmountInput(event.target.value);
                  setAmountInput(nextValue.formatted);
                  setAmount(nextValue.raw ? Number(nextValue.raw) : null);
                }}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="purchase-date">
                Дата покупки
              </label>
              <input
                id="purchase-date"
                className={styles.input}
                type="date"
                min={minPurchaseDate || undefined}
                max={new Date().toISOString().slice(0, 10)}
                value={purchaseDate}
                onChange={(event) => {
                  setPurchaseDate(event.target.value);
                }}
              />
            </div>

            <button className={styles.button} type="submit" disabled={!isFormValid || isLoading}>
              {isLoading ? "Считаем..." : "Рассчитать"}
            </button>
          </form>

          <p className={styles.helper}>
            Показываем, сколько бы вы заработали, купив акцию в выбранную дату и продав сегодня
          </p>

          {error ? <p className={`${styles.status} ${styles.statusError}`}>{error}</p> : null}
        </div>

        {result ? (
          <section className={styles.results}>
            {!comparisonMode ? (
              <>
                <div className={styles.cards}>
                  <div className={styles.card}>
                    <span className={styles.cardLabel}>Начальная сумма</span>
                    <span className={styles.cardValue}>{formatRubles(result.initialAmount)}</span>
                  </div>
                  <div className={styles.card}>
                    <span className={styles.cardLabel}>Итоговая сумма</span>
                    <span className={styles.cardValue}>{formatRubles(result.finalAmount)}</span>
                    {result.dividendIncome > 0 ? (
                      <div className={styles.dividendNote}>
                        из них дивиденды: +{result.dividendIncome.toLocaleString("ru-RU")} ₽
                      </div>
                    ) : null}
                  </div>
                  <div className={styles.card}>
                    <span className={styles.cardLabel}>Доходность</span>
                    <span className={`${styles.cardValue} ${returnClassName}`}>
                      {result.returnPercent.toLocaleString("ru-RU")}%
                    </span>
                  </div>
                </div>

                <div className={styles.chartWrap}>
                  <p className={styles.chartTitle}>
                    Динамика с {formatDateLabel(result.startDate)} по {formatDateLabel(result.endDate)}
                  </p>
                  <ResponsiveContainer width="100%" height={420}>
                    <LineChart data={comparisonChartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                      <CartesianGrid stroke="#e5e7eb" vertical={false} />
                      <XAxis
                        dataKey="date"
                        minTickGap={32}
                        tickFormatter={(value: string) => formatDateLabel(value)}
                        stroke="#6b7280"
                        tick={{ fontSize: 12 }}
                      />
                      <YAxis
                        domain={["dataMin - 5", "dataMax + 5"]}
                        stroke="#6b7280"
                        tick={{ fontSize: 12 }}
                        tickFormatter={(value: number) => `${value.toFixed(0)}`}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="stock"
                        stroke="#111111"
                        strokeWidth={2}
                        dot={false}
                        name="Акция"
                      />
                      <Line
                        type="monotone"
                        dataKey="imoex"
                        stroke="#2563eb"
                        strokeWidth={2}
                        dot={false}
                        name="IMOEX"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                  <p className={`${styles.status} ${styles.statusMuted}`}>
                    Итог по акции: {formatRubles(result.finalAmount)} ({formatSignedRubles(result.profitLoss)})
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className={styles.comparisonCards}>
                  <div
                    className={`${styles.card} ${styles.comparisonCard} ${
                      winner === "primary" ? styles.winnerCard : ""
                    }`}
                  >
                    <div className={styles.comparisonCardTop}>
                      <span className={styles.cardLabel}>Первая акция</span>
                      {winner === "primary" ? (
                        <span className={styles.winnerBadge}>победитель</span>
                      ) : null}
                    </div>
                    <div className={styles.comparisonTicker}>{selectedStock?.ticker}</div>
                    <div className={styles.comparisonName}>{selectedStock?.name}</div>
                    <div className={styles.cardValue}>{formatRubles(result.finalAmount)}</div>
                    {result.dividendIncome > 0 ? (
                      <div className={styles.dividendNote}>
                        из них дивиденды: +{result.dividendIncome.toLocaleString("ru-RU")} ₽
                      </div>
                    ) : null}
                    <div
                      className={`${styles.comparisonMeta} ${
                        result.profitLoss >= 0 ? styles.positive : styles.negative
                      }`}
                    >
                      {formatSignedRubles(result.profitLoss)}
                    </div>
                    <div
                      className={`${styles.comparisonReturn} ${
                        result.returnPercent >= 0 ? styles.positive : styles.negative
                      }`}
                    >
                      {formatSignedPercent(result.returnPercent)}
                    </div>
                  </div>

                  <div
                    className={`${styles.card} ${styles.comparisonCard} ${
                      winner === "comparison" ? styles.winnerCard : ""
                    }`}
                  >
                    <div className={styles.comparisonCardTop}>
                      <span className={styles.cardLabel}>Вторая акция</span>
                      {winner === "comparison" ? (
                        <span className={styles.winnerBadge}>победитель</span>
                      ) : null}
                    </div>
                    <div className={styles.comparisonTicker}>{comparisonStock?.ticker}</div>
                    <div className={styles.comparisonName}>{comparisonStock?.name}</div>
                    <div className={styles.cardValue}>
                      {comparisonResult ? formatRubles(comparisonResult.finalAmount) : "—"}
                    </div>
                    {comparisonResult && comparisonResult.dividendIncome > 0 ? (
                      <div className={styles.dividendNote}>
                        из них дивиденды: +{comparisonResult.dividendIncome.toLocaleString("ru-RU")} ₽
                      </div>
                    ) : null}
                    <div
                      className={`${styles.comparisonMeta} ${
                        comparisonResult && comparisonResult.profitLoss >= 0 ? styles.positive : styles.negative
                      }`}
                    >
                      {comparisonResult ? formatSignedRubles(comparisonResult.profitLoss) : "—"}
                    </div>
                    <div
                      className={`${styles.comparisonReturn} ${
                        comparisonResult && comparisonResult.returnPercent >= 0
                          ? styles.positive
                          : styles.negative
                      }`}
                    >
                      {comparisonResult ? formatSignedPercent(comparisonResult.returnPercent) : "—"}
                    </div>
                  </div>
                </div>

                <div className={`${styles.card} ${styles.verdictCard}`}>
                  {verdict?.text ? (
                    <span className={styles.verdictText}>{verdict.text}</span>
                  ) : (
                    <span className={styles.verdictText}>
                      {verdict?.winnerTicker} обогнал {verdict?.loserTicker} на{" "}
                      <strong className={styles.verdictStrong}>{verdict?.percentDifference}</strong> — разница{" "}
                      <strong className={styles.verdictStrong}>{verdict?.amountDifference}</strong>
                    </span>
                  )}
                </div>

                <div className={styles.chartWrap}>
                  <p className={styles.chartTitle}>
                    Динамика с {formatDateLabel(result.startDate)} по {formatDateLabel(result.endDate)}
                  </p>
                  <ResponsiveContainer width="100%" height={420}>
                    <LineChart data={comparisonChartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                      <CartesianGrid stroke="#e5e7eb" vertical={false} />
                      <XAxis
                        dataKey="date"
                        minTickGap={32}
                        tickFormatter={(value: string) => formatDateLabel(value)}
                        stroke="#6b7280"
                        tick={{ fontSize: 12 }}
                      />
                      <YAxis
                        domain={["dataMin - 5", "dataMax + 5"]}
                        stroke="#6b7280"
                        tick={{ fontSize: 12 }}
                        tickFormatter={(value: number) => `${value.toFixed(0)}`}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="stock"
                        stroke="#111111"
                        strokeWidth={2}
                        dot={false}
                        name={selectedStock?.ticker ?? "Первая акция"}
                      />
                      <Line
                        type="monotone"
                        dataKey="comparison"
                        stroke="#D85A30"
                        strokeWidth={2}
                        dot={false}
                        name={comparisonStock?.ticker ?? "Вторая акция"}
                      />
                      <Line
                        type="monotone"
                        dataKey="imoex"
                        stroke="#6b7280"
                        strokeWidth={2}
                        strokeDasharray="6 4"
                        dot={false}
                        name="IMOEX"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </section>
        ) : null}
          </>
        ) : (
          renderTopStocks()
        )}
      </main>

      {renderDropdown({
        isOpen: isPrimaryDropdownOpen,
        position: primaryDropdownPosition,
        results: primarySearchResults,
        isSearching: isPrimarySearching,
        searchError: primarySearchError,
        onSelect: (stock) => {
          void handleSelectStock(stock);
        }
      })}

      {renderDropdown({
        isOpen: isComparisonDropdownOpen,
        position: comparisonDropdownPosition,
        results: comparisonSearchResults,
        isSearching: isComparisonSearching,
        searchError: comparisonSearchError,
        onSelect: (stock) => {
          void handleSelectComparisonStock(stock);
        }
      })}

      <footer className={styles.footer}>
        <div className={styles.footerInner}>Данные: Московская биржа (MOEX ISS API)</div>
      </footer>
    </div>
  );
}
