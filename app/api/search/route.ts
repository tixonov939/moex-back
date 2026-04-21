import { NextResponse } from "next/server";
import { searchSecurities } from "@/lib/moex";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";

  try {
    const results = await searchSecurities(query);
    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Не удалось выполнить поиск."
      },
      { status: 500 }
    );
  }
}
