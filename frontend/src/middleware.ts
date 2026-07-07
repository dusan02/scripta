export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    /*
     * Chránime všetky vnútorné routy, ktoré vyžadujú prihlásenie.
     */
    "/dashboard",
    "/reports/:path*",
    "/history/:path*",
    "/settings/:path*",
    "/messages/:path*",
    "/admin/:path*",
    "/plan"
  ],
};
