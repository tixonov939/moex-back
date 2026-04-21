import { NextResponse } from "next/server";
import { getTopStocks, type TopPeriod } from "@/lib/moex";

export const dynamic = "force-dynamic";

const ALLOWED_PERIODS: TopPeriod[] = ["1y", "3y", "5y"];

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") as TopPeriod | null;
    const normalizedPeriod = period && ALLOWED_PERIODS.includes(period) ? period : "3y";

    const result = await getTopStocks(normalizedPeriod);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Не удалось загрузить топ акций."
      },
      { status: 500 }
    );
  }
}
