import { NextResponse, type NextRequest } from "next/server";
import {
  isApiRequestAllowed,
  isApiRequestHostAllowed,
} from "@/lib/request-security";
import {
  isValidBasicAuthorization,
  isWebPasswordEnabled,
} from "@/lib/web-auth";
// PowerI 网关模式（ticket 04）：多用户认证（POWERI_WEB_USERS 表优先，回退单用户 POWERI_WEB_PASSWORD）
import { gatewayConfig, resolveWebUser } from "@/lib/gateway-client";

export function proxy(request: NextRequest) {
  const isApiRequest = request.nextUrl.pathname === "/api"
    || request.nextUrl.pathname.startsWith("/api/");
  const isTrustedRequest = isApiRequest
    ? isApiRequestAllowed(request)
    : isApiRequestHostAllowed(request);

  if (!isTrustedRequest) {
    if (!isApiRequest) {
      return new NextResponse("Untrusted request", { status: 403 });
    }
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const password = process.env.PI_WEB_PASSWORD;
  // ── PowerI 网关模式（ticket 04）：每用户认证（用户名→网关 token 请求级解析）──
  if (gatewayConfig.enabled) {
    const webPassword = process.env.POWERI_WEB_PASSWORD;
    const webUsers = process.env.POWERI_WEB_USERS;
    if (
      (webPassword || webUsers || isWebPasswordEnabled(password))
      && !resolveWebUser(request.headers.get("authorization"))
    ) {
      return new NextResponse("Authentication required", {
        status: 401,
        headers: {
          "Cache-Control": "no-store",
          "WWW-Authenticate": 'Basic realm="Pi Web", charset="UTF-8"',
        },
      });
    }
    return NextResponse.next();
  }
  if (
    isWebPasswordEnabled(password)
    && !isValidBasicAuthorization(request.headers.get("authorization"), password)
  ) {
    return new NextResponse("Authentication required", {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": 'Basic realm="Pi Web", charset="UTF-8"',
      },
    });
  }

  return NextResponse.next();
}

export const config = { matcher: ["/", "/api/:path*"] };
