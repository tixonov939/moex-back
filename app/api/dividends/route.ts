import { NextResponse } from "next/server";
import { getDividends } from "@/lib/moex";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get("ticker")?.trim().toUpperCase();

    if (!ticker) {
      return NextResponse.json({ error: "Укажите тикер." }, { status: 400 });
    }

    const dividends = await getDividends(ticker);
    return NextResponse.json({ dividends });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Не удалось получить историю дивидендов."
      },
      { status: 500 }
    );
  }
}
