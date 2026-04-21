import { addDays, getTodayIsoDate } from "@/lib/date";

const MOEX_BASE_URL = "https://iss.moex.com/iss";
const DEFAULT_PAGE_SIZE = 100;

type MoexBlock = {
  columns?: string[];
  data?: unknown[][];
};

type MoexResponse = Record<string, MoexBlock | unknown>;

export type SearchResult = {
  ticker: string;
  name: string;
};

export type PricePoint = {
  date: string;
  close: number;
};

export type DividendPoint = {
  date: string;
  value: number;
};

export type BacktestPoint = {
  date: string;
  stock: number;
  imoex: number;
  stockValue: number;
  imoexValue: number;
};

export type BacktestResult = {
  initialAmount: number;
  finalAmount: number;
  dividendIncome: number;
  profitLoss: number;
  returnPercent: number;
  startDate: string;
  endDate: string;
  points: BacktestPoint[];
};

export type TopPeriod = "1y" | "3y" | "5y";

export type TopStockItem = {
  ticker: string;
  shortname: string;
  currentPrice: number;
  returnPct: number;
  sparkline: number[];
};

export type TopStocksResult = {
  updatedAt: string;
  items: TopStockItem[];
};

type CachedTopStocks = {
  expiresAt: number;
  value: TopStocksResult;
};

const TOP_STOCKS_CACHE = new Map<TopPeriod, CachedTopStocks>();
const TOP_STOCKS_CACHE_TTL = 60 * 60 * 1000;

function getBlock(response: MoexResponse, key: string): MoexBlock {
  const block = response[key];
  if (!block || typeof block !== "object") {
    return {};
  }

  return block as MoexBlock;
}

function mapRows<T>(
  block: MoexBlock,
  mapper: (row: Record<string, unknown>) => T | null
): T[] {
  if (!block.columns || !block.data) {
    return [];
  }

  return block.data
    .map((values) => {
      const row = block.columns!.reduce<Record<string, unknown>>((accumulator, column, index) => {
        accumulator[column] = values[index];
        accumulator[column.toUpperCase()] = values[index];
        return accumulator;
      }, {});

      return mapper(row);
    })
    .filter((value): value is T => value !== null);
}

function getRowValue(row: Record<string, unknown>, field: string) {
  return row[field] ?? row[field.toUpperCase()] ?? row[field.toLowerCase()];
}

async function fetchMoexJson(path: string, params: Record<string, string> = {}) {
  const url = new URL(`${MOEX_BASE_URL}${path}`);

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  url.searchParams.set("iss.meta", "off");

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json"
    },
    next: { revalidate: 0 }
  });

  if (!response.ok) {
    throw new Error(`MOEX ISS API вернул ошибку ${response.status}`);
  }

  return (await response.json()) as MoexResponse;
}

async function fetchPaginatedHistory(path: string, from: string): Promise<PricePoint[]> {
  const allRows: PricePoint[] = [];
  let start = 0;

  while (true) {
    const response = await fetchMoexJson(path, {
      from,
      start: String(start),
      limit: String(DEFAULT_PAGE_SIZE)
    });

    const block = getBlock(response, "history");
    const pageRows = mapRows(block, (row) => {
      const tradeDate = getRowValue(row, "TRADEDATE");
      const closeCandidates = [
        getRowValue(row, "CLOSE"),
        getRowValue(row, "LEGALCLOSEPRICE"),
        getRowValue(row, "MARKETPRICE3"),
        getRowValue(row, "MARKETPRICE2"),
        getRowValue(row, "WAPRICE"),
        getRowValue(row, "ADMITTEDQUOTE")
      ];
      const close = closeCandidates.find(
        (value): value is number => typeof value === "number" && !Number.isNaN(value) && value > 0
      );

      if (typeof tradeDate !== "string" || typeof close !== "number" || Number.isNaN(close)) {
        return null;
      }

      return {
        date: tradeDate,
        close
      };
    });

    allRows.push(...pageRows);

    if (pageRows.length < DEFAULT_PAGE_SIZE) {
      break;
    }

    start += DEFAULT_PAGE_SIZE;
  }

  return allRows;
}

function ensureStartPoint(points: PricePoint[], startDate: string): PricePoint[] {
  if (points.length === 0) {
    return [];
  }

  const firstPoint = points[0];

  if (firstPoint.date === startDate) {
    return points;
  }

  return [
    {
      date: startDate,
      close: firstPoint.close
    },
    ...points
  ];
}

function normalizeSeries(value: number, startValue: number): number {
  return Number(((value / startValue) * 100).toFixed(2));
}

function subtractYears(dateString: string, years: number) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setFullYear(date.getFullYear() - years);
  return date.toISOString().slice(0, 10);
}

function getPeriodStartDate(period: TopPeriod, endDate: string) {
  switch (period) {
    case "1y":
      return subtractYears(endDate, 1);
    case "5y":
      return subtractYears(endDate, 5);
    case "3y":
    default:
      return subtractYears(endDate, 3);
  }
}

function sampleSparkline(points: PricePoint[], steps: number) {
  if (points.length === 0) {
    return [];
  }

  if (points.length === 1) {
    return Array.from({ length: steps }, () => Number(points[0].close.toFixed(2)));
  }

  return Array.from({ length: steps }, (_, index) => {
    const sampleIndex = Math.round((index / (steps - 1)) * (points.length - 1));
    return Number(points[sampleIndex].close.toFixed(2));
  });
}

function buildLinearSparkline(startPrice: number, currentPrice: number, steps: number) {
  if (steps <= 1) {
    return [Number(currentPrice.toFixed(2))];
  }

  return Array.from({ length: steps }, (_, index) => {
    const progress = index / (steps - 1);
    return Number((startPrice + (currentPrice - startPrice) * progress).toFixed(2));
  });
}

async function fetchBoardSecuritiesByVolume() {
  const allSecurities: { ticker: string; shortname: string; value: number; currentPrice: number }[] = [];
  let start = 0;

  while (true) {
    const response = await fetchMoexJson("/engines/stock/markets/shares/boards/TQBR/securities.json", {
      start: String(start),
      limit: String(DEFAULT_PAGE_SIZE)
    });

    const securities = mapRows(getBlock(response, "securities"), (row) => {
      const ticker = getRowValue(row, "SECID");
      const shortname = getRowValue(row, "SHORTNAME");

      if (typeof ticker !== "string") {
        return null;
      }

      return {
        ticker,
        shortname: typeof shortname === "string" && shortname.trim() ? shortname : ticker
      };
    });

    const marketdata = mapRows(getBlock(response, "marketdata"), (row) => {
      const ticker = getRowValue(row, "SECID");
      const valueCandidates = [
        getRowValue(row, "VALUE"),
        getRowValue(row, "VALTODAY"),
        getRowValue(row, "VOLRUR")
      ];
      const value = valueCandidates.find(
        (candidate): candidate is number =>
          typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0
      );

      if (typeof ticker !== "string" || typeof value !== "number") {
        return null;
      }

      return { ticker, value };
    });

    const marketdataMap = new Map(marketdata.map((item) => [item.ticker, item.value]));
    const pageItems = securities
      .map((security) => ({
        ticker: security.ticker,
        shortname: security.shortname,
        value: marketdataMap.get(security.ticker) ?? 0,
        currentPrice:
          (() => {
            const marketRow = marketdata.find((item) => item.ticker === security.ticker);
            if (!marketRow) {
              return 0;
            }
            return marketRow.value;
          })()
      }))
      .filter((item) => item.value > 0);

    allSecurities.push(...pageItems);

    if (securities.length < DEFAULT_PAGE_SIZE) {
      break;
    }

    start += DEFAULT_PAGE_SIZE;
  }

  return allSecurities.sort((left, right) => right.value - left.value);
}

async function fetchBoardSecuritiesSnapshot() {
  const response = await fetchMoexJson("/engines/stock/markets/shares/boards/TQBR/securities.json");

  const securities = mapRows(getBlock(response, "securities"), (row) => {
    const ticker = getRowValue(row, "SECID");
    const shortname = getRowValue(row, "SHORTNAME");

    if (typeof ticker !== "string") {
      return null;
    }

    return {
      ticker,
      shortname: typeof shortname === "string" && shortname.trim() ? shortname : ticker
    };
  });

  const marketdata = mapRows(getBlock(response, "marketdata"), (row) => {
    const ticker = getRowValue(row, "SECID");
    const valueCandidates = [
      getRowValue(row, "VALUE"),
      getRowValue(row, "VALTODAY"),
      getRowValue(row, "VOLRUR")
    ];
    const currentPriceCandidates = [
      getRowValue(row, "LAST"),
      getRowValue(row, "LEGALCLOSEPRICE"),
      getRowValue(row, "MARKETPRICE3"),
      getRowValue(row, "MARKETPRICE2"),
      getRowValue(row, "WAPRICE"),
      getRowValue(row, "ADMITTEDQUOTE")
    ];
    const value = valueCandidates.find(
      (candidate): candidate is number =>
        typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0
    );
    const currentPrice = currentPriceCandidates.find(
      (candidate): candidate is number =>
        typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0
    );

    if (typeof ticker !== "string" || typeof value !== "number") {
      return null;
    }

    return {
      ticker,
      value,
      currentPrice: typeof currentPrice === "number" ? currentPrice : 0
    };
  });

  const marketdataMap = new Map(marketdata.map((item) => [item.ticker, item]));

  return securities
    .map((security) => {
      const marketSnapshot = marketdataMap.get(security.ticker);

      return {
        ticker: security.ticker,
        shortname: security.shortname,
        value: marketSnapshot?.value ?? 0,
        currentPrice: marketSnapshot?.currentPrice ?? 0
      };
    })
    .filter((item) => item.value > 0 && item.currentPrice > 0)
    .sort((left, right) => right.value - left.value);
}

async function fetchFirstHistoryPoint(path: string, from: string): Promise<PricePoint | null> {
  const response = await fetchMoexJson(path, {
    from,
    limit: "1"
  });

  const rows = mapRows(getBlock(response, "history"), (row) => {
    const tradeDate = getRowValue(row, "TRADEDATE");
    const closeCandidates = [
      getRowValue(row, "CLOSE"),
      getRowValue(row, "LEGALCLOSEPRICE"),
      getRowValue(row, "MARKETPRICE3"),
      getRowValue(row, "MARKETPRICE2"),
      getRowValue(row, "WAPRICE"),
      getRowValue(row, "ADMITTEDQUOTE")
    ];
    const close = closeCandidates.find(
      (value): value is number => typeof value === "number" && !Number.isNaN(value) && value > 0
    );

    if (typeof tradeDate !== "string" || typeof close !== "number" || Number.isNaN(close)) {
      return null;
    }

    return {
      date: tradeDate,
      close
    };
  });

  return rows[0] ?? null;
}

async function mapInBatches<T, R>(
  items: T[],
  batchSize: number,
  mapper: (item: T) => Promise<R>
) {
  const results: R[] = [];

  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    const batchResults = await Promise.all(batch.map((item) => mapper(item)));
    results.push(...batchResults);
  }

  return results;
}

export async function searchSecurities(query: string): Promise<SearchResult[]> {
  if (!query.trim()) {
    return [];
  }

  const response = await fetchMoexJson("/securities.json", {
    q: query.trim(),
    engines: "stock",
    markets: "shares",
    limit: "20",
    "iss.only": "securities"
  });

  return mapRows(getBlock(response, "securities"), (row) => {
    const ticker = getRowValue(row, "SECID");
    const shortName = getRowValue(row, "SHORTNAME");
    const fullName = getRowValue(row, "NAME");

    if (typeof ticker !== "string") {
      return null;
    }

    return {
      ticker,
      name:
        typeof fullName === "string" && fullName.trim()
          ? fullName
          : typeof shortName === "string"
            ? shortName
            : ticker
    };
  });
}

export async function getFirstTradeDate(ticker: string): Promise<string> {
  const response = await fetchMoexJson(
    `/history/engines/stock/markets/shares/boards/TQBR/securities/${ticker}.json`,
    {
      from: "1993-01-01",
      limit: "1"
    }
  );

  const rows = mapRows(getBlock(response, "history"), (row) => {
    const tradeDate = getRowValue(row, "TRADEDATE");
    return typeof tradeDate === "string" ? tradeDate : null;
  });

  if (!rows[0]) {
    throw new Error("Не удалось определить первую дату торгов по этой бумаге.");
  }

  return rows[0];
}

export async function getDividends(ticker: string): Promise<DividendPoint[]> {
  try {
    const response = await fetchMoexJson(`/securities/${ticker}/dividends.json`);

    return mapRows(getBlock(response, "dividends"), (row) => {
      const date = getRowValue(row, "REGISTRYCLOSEDATE");
      const value = getRowValue(row, "VALUE");

      if (typeof date !== "string" || typeof value !== "number" || Number.isNaN(value)) {
        return null;
      }

      return { date, value };
    }).sort((left, right) => left.date.localeCompare(right.date));
  } catch {
    return [];
  }
}

export async function getTopStocks(period: TopPeriod): Promise<TopStocksResult> {
  const cached = TOP_STOCKS_CACHE.get(period);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const endDate = getTodayIsoDate();
  const startDate = getPeriodStartDate(period, endDate);
  const topByVolume = (await fetchBoardSecuritiesSnapshot()).slice(0, 15);

  const items = (
    await mapInBatches(topByVolume, 5, async (security) => {
        try {
          const startPoint = await fetchFirstHistoryPoint(
              `/history/engines/stock/markets/shares/boards/TQBR/securities/${security.ticker}.json`,
              startDate
          );

          if (!startPoint) {
            return null;
          }

          const startPrice = startPoint.close;
          const currentPrice = security.currentPrice;

          if (!Number.isFinite(startPrice) || startPrice <= 0 || !Number.isFinite(currentPrice)) {
            return null;
          }

          return {
            ticker: security.ticker,
            shortname: security.shortname,
            currentPrice: Number(currentPrice.toFixed(2)),
            returnPct: Number((((currentPrice - startPrice) / startPrice) * 100).toFixed(2)),
            sparkline: buildLinearSparkline(startPrice, currentPrice, 8)
          };
        } catch {
          return null;
        }
      })
  )
    .filter((item): item is TopStockItem => item !== null)
    .sort((left, right) => right.returnPct - left.returnPct)
    .slice(0, 15);

  const result = {
    updatedAt: new Date().toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit"
    }),
    items
  };

  TOP_STOCKS_CACHE.set(period, {
    expiresAt: Date.now() + TOP_STOCKS_CACHE_TTL,
    value: result
  });

  return result;
}

export async function calculateBacktest(ticker: string, purchaseDate: string, amount: number): Promise<BacktestResult> {
  const endDate = getTodayIsoDate();
  const [stockHistory, imoexHistory, dividends] = await Promise.all([
    fetchPaginatedHistory(
      `/history/engines/stock/markets/shares/boards/TQBR/securities/${ticker}.json`,
      purchaseDate
    ),
    fetchPaginatedHistory(
      "/history/engines/stock/markets/index/boards/SNDX/securities/IMOEX.json",
      purchaseDate
    ),
    getDividends(ticker)
  ]);

  const stockPoints = ensureStartPoint(stockHistory, purchaseDate);
  const indexPoints = ensureStartPoint(imoexHistory, purchaseDate);

  if (stockPoints.length === 0) {
    throw new Error("Не удалось получить историю цены акции.");
  }

  if (indexPoints.length === 0) {
    throw new Error("Не удалось получить историю индекса IMOEX.");
  }

  const startDate = purchaseDate;

  const stockMap = new Map(stockPoints.map((point) => [point.date, point.close]));
  const indexMap = new Map(indexPoints.map((point) => [point.date, point.close]));

  const stockStartPrice = stockPoints[0].close;
  const indexStartPrice = indexPoints[0].close;
  const shares = amount / stockStartPrice;
  const indexUnits = amount / indexStartPrice;
  const dividendIncome = dividends
    .filter((dividend) => dividend.date >= startDate && dividend.date <= endDate)
    .reduce((total, dividend) => total + shares * dividend.value, 0);

  const points: BacktestPoint[] = [];
  let currentStockPrice = stockStartPrice;
  let currentIndexPrice = indexStartPrice;
  let currentDate = startDate;

  while (currentDate <= endDate) {
    currentStockPrice = stockMap.get(currentDate) ?? currentStockPrice;
    currentIndexPrice = indexMap.get(currentDate) ?? currentIndexPrice;

    const stockValue = shares * currentStockPrice;
    const imoexValue = indexUnits * currentIndexPrice;

    points.push({
      date: currentDate,
      stock: normalizeSeries(stockValue, amount),
      imoex: normalizeSeries(imoexValue, amount),
      stockValue: Number(stockValue.toFixed(2)),
      imoexValue: Number(imoexValue.toFixed(2))
    });

    currentDate = addDays(currentDate, 1);
  }

  const stockFinalAmount = points[points.length - 1]?.stockValue ?? amount;
  const finalAmount = stockFinalAmount + dividendIncome;
  const profitLoss = finalAmount - amount;
  const returnPercent = amount === 0 ? 0 : (profitLoss / amount) * 100;

  return {
    initialAmount: amount,
    finalAmount: Number(finalAmount.toFixed(2)),
    dividendIncome: Number(dividendIncome.toFixed(2)),
    profitLoss: Number(profitLoss.toFixed(2)),
    returnPercent: Number(returnPercent.toFixed(2)),
    startDate,
    endDate,
    points
  };
}
