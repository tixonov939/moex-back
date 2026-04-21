import { NextResponse } from "next/server";
import { calculateBacktest } from "@/lib/moex";

export const dynamic = "force-dynamic";

type BacktestPayload = {
  ticker?: string;
  purchaseDate?: string;
  amount?: number;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as BacktestPayload;
    const ticker = body.ticker?.trim().toUpperCase();
    const purchaseDate = body.purchaseDate;
    const amount = Number(body.amount);

    if (!ticker) {
      return NextResponse.json({ error: "Выберите акцию." }, { status: 400 });
    }

    if (!purchaseDate) {
      return NextResponse.json({ error: "Укажите дату покупки." }, { status: 400 });
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Введите сумму инвестиций." }, { status: 400 });
    }

    const result = await calculateBacktest(ticker, purchaseDate, amount);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Не удалось выполнить расчет."
      },
      { status: 500 }
    );
  }
}
