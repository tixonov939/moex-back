import { NextResponse } from "next/server";
import { getFirstTradeDate } from "@/lib/moex";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { ticker: string } }
) {
  try {
    const firstTradeDate = await getFirstTradeDate(params.ticker);
    return NextResponse.json({ firstTradeDate });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось получить первую дату торгов."
      },
      { status: 500 }
    );
  }
}
