import { cookies } from "next/headers";
import { normalizeOperatorName, OPERATOR_NAME_COOKIE } from "@/lib/operator";

export async function getCurrentOperatorName() {
  const cookieStore = await cookies();
  return normalizeOperatorName(cookieStore.get(OPERATOR_NAME_COOKIE)?.value);
}

