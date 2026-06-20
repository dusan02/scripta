"use strict";
/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
(() => {
var exports = {};
exports.id = "app/api/reports/[id]/route";
exports.ids = ["app/api/reports/[id]/route"];
exports.modules = {

/***/ "@prisma/client":
/*!*********************************!*\
  !*** external "@prisma/client" ***!
  \*********************************/
/***/ ((module) => {

module.exports = require("@prisma/client");

/***/ }),

/***/ "../../client/components/action-async-storage.external":
/*!*******************************************************************************!*\
  !*** external "next/dist/client/components/action-async-storage.external.js" ***!
  \*******************************************************************************/
/***/ ((module) => {

module.exports = require("next/dist/client/components/action-async-storage.external.js");

/***/ }),

/***/ "../../client/components/request-async-storage.external":
/*!********************************************************************************!*\
  !*** external "next/dist/client/components/request-async-storage.external.js" ***!
  \********************************************************************************/
/***/ ((module) => {

module.exports = require("next/dist/client/components/request-async-storage.external.js");

/***/ }),

/***/ "../../client/components/static-generation-async-storage.external":
/*!******************************************************************************************!*\
  !*** external "next/dist/client/components/static-generation-async-storage.external.js" ***!
  \******************************************************************************************/
/***/ ((module) => {

module.exports = require("next/dist/client/components/static-generation-async-storage.external.js");

/***/ }),

/***/ "next/dist/compiled/next-server/app-page.runtime.dev.js":
/*!*************************************************************************!*\
  !*** external "next/dist/compiled/next-server/app-page.runtime.dev.js" ***!
  \*************************************************************************/
/***/ ((module) => {

module.exports = require("next/dist/compiled/next-server/app-page.runtime.dev.js");

/***/ }),

/***/ "next/dist/compiled/next-server/app-route.runtime.dev.js":
/*!**************************************************************************!*\
  !*** external "next/dist/compiled/next-server/app-route.runtime.dev.js" ***!
  \**************************************************************************/
/***/ ((module) => {

module.exports = require("next/dist/compiled/next-server/app-route.runtime.dev.js");

/***/ }),

/***/ "assert":
/*!*************************!*\
  !*** external "assert" ***!
  \*************************/
/***/ ((module) => {

module.exports = require("assert");

/***/ }),

/***/ "buffer":
/*!*************************!*\
  !*** external "buffer" ***!
  \*************************/
/***/ ((module) => {

module.exports = require("buffer");

/***/ }),

/***/ "crypto":
/*!*************************!*\
  !*** external "crypto" ***!
  \*************************/
/***/ ((module) => {

module.exports = require("crypto");

/***/ }),

/***/ "events":
/*!*************************!*\
  !*** external "events" ***!
  \*************************/
/***/ ((module) => {

module.exports = require("events");

/***/ }),

/***/ "http":
/*!***********************!*\
  !*** external "http" ***!
  \***********************/
/***/ ((module) => {

module.exports = require("http");

/***/ }),

/***/ "https":
/*!************************!*\
  !*** external "https" ***!
  \************************/
/***/ ((module) => {

module.exports = require("https");

/***/ }),

/***/ "querystring":
/*!******************************!*\
  !*** external "querystring" ***!
  \******************************/
/***/ ((module) => {

module.exports = require("querystring");

/***/ }),

/***/ "url":
/*!**********************!*\
  !*** external "url" ***!
  \**********************/
/***/ ((module) => {

module.exports = require("url");

/***/ }),

/***/ "util":
/*!***********************!*\
  !*** external "util" ***!
  \***********************/
/***/ ((module) => {

module.exports = require("util");

/***/ }),

/***/ "zlib":
/*!***********************!*\
  !*** external "zlib" ***!
  \***********************/
/***/ ((module) => {

module.exports = require("zlib");

/***/ }),

/***/ "(rsc)/./node_modules/next/dist/build/webpack/loaders/next-app-loader.js?name=app%2Fapi%2Freports%2F%5Bid%5D%2Froute&page=%2Fapi%2Freports%2F%5Bid%5D%2Froute&appPaths=&pagePath=private-next-app-dir%2Fapi%2Freports%2F%5Bid%5D%2Froute.ts&appDir=D%3A%5CProjects%5CScripta%5Cfrontend%5Csrc%5Capp&pageExtensions=tsx&pageExtensions=ts&pageExtensions=jsx&pageExtensions=js&rootDir=D%3A%5CProjects%5CScripta%5Cfrontend&isDev=true&tsconfigPath=tsconfig.json&basePath=&assetPrefix=&nextConfigOutput=&preferredRegion=&middlewareConfig=e30%3D!":
/*!****************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************!*\
  !*** ./node_modules/next/dist/build/webpack/loaders/next-app-loader.js?name=app%2Fapi%2Freports%2F%5Bid%5D%2Froute&page=%2Fapi%2Freports%2F%5Bid%5D%2Froute&appPaths=&pagePath=private-next-app-dir%2Fapi%2Freports%2F%5Bid%5D%2Froute.ts&appDir=D%3A%5CProjects%5CScripta%5Cfrontend%5Csrc%5Capp&pageExtensions=tsx&pageExtensions=ts&pageExtensions=jsx&pageExtensions=js&rootDir=D%3A%5CProjects%5CScripta%5Cfrontend&isDev=true&tsconfigPath=tsconfig.json&basePath=&assetPrefix=&nextConfigOutput=&preferredRegion=&middlewareConfig=e30%3D! ***!
  \****************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   originalPathname: () => (/* binding */ originalPathname),\n/* harmony export */   patchFetch: () => (/* binding */ patchFetch),\n/* harmony export */   requestAsyncStorage: () => (/* binding */ requestAsyncStorage),\n/* harmony export */   routeModule: () => (/* binding */ routeModule),\n/* harmony export */   serverHooks: () => (/* binding */ serverHooks),\n/* harmony export */   staticGenerationAsyncStorage: () => (/* binding */ staticGenerationAsyncStorage)\n/* harmony export */ });\n/* harmony import */ var next_dist_server_future_route_modules_app_route_module_compiled__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! next/dist/server/future/route-modules/app-route/module.compiled */ \"(rsc)/./node_modules/next/dist/server/future/route-modules/app-route/module.compiled.js\");\n/* harmony import */ var next_dist_server_future_route_modules_app_route_module_compiled__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(next_dist_server_future_route_modules_app_route_module_compiled__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var next_dist_server_future_route_kind__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! next/dist/server/future/route-kind */ \"(rsc)/./node_modules/next/dist/server/future/route-kind.js\");\n/* harmony import */ var next_dist_server_lib_patch_fetch__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! next/dist/server/lib/patch-fetch */ \"(rsc)/./node_modules/next/dist/server/lib/patch-fetch.js\");\n/* harmony import */ var next_dist_server_lib_patch_fetch__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(next_dist_server_lib_patch_fetch__WEBPACK_IMPORTED_MODULE_2__);\n/* harmony import */ var D_Projects_Scripta_frontend_src_app_api_reports_id_route_ts__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./src/app/api/reports/[id]/route.ts */ \"(rsc)/./src/app/api/reports/[id]/route.ts\");\n\n\n\n\n// We inject the nextConfigOutput here so that we can use them in the route\n// module.\nconst nextConfigOutput = \"\"\nconst routeModule = new next_dist_server_future_route_modules_app_route_module_compiled__WEBPACK_IMPORTED_MODULE_0__.AppRouteRouteModule({\n    definition: {\n        kind: next_dist_server_future_route_kind__WEBPACK_IMPORTED_MODULE_1__.RouteKind.APP_ROUTE,\n        page: \"/api/reports/[id]/route\",\n        pathname: \"/api/reports/[id]\",\n        filename: \"route\",\n        bundlePath: \"app/api/reports/[id]/route\"\n    },\n    resolvedPagePath: \"D:\\\\Projects\\\\Scripta\\\\frontend\\\\src\\\\app\\\\api\\\\reports\\\\[id]\\\\route.ts\",\n    nextConfigOutput,\n    userland: D_Projects_Scripta_frontend_src_app_api_reports_id_route_ts__WEBPACK_IMPORTED_MODULE_3__\n});\n// Pull out the exports that we need to expose from the module. This should\n// be eliminated when we've moved the other routes to the new format. These\n// are used to hook into the route.\nconst { requestAsyncStorage, staticGenerationAsyncStorage, serverHooks } = routeModule;\nconst originalPathname = \"/api/reports/[id]/route\";\nfunction patchFetch() {\n    return (0,next_dist_server_lib_patch_fetch__WEBPACK_IMPORTED_MODULE_2__.patchFetch)({\n        serverHooks,\n        staticGenerationAsyncStorage\n    });\n}\n\n\n//# sourceMappingURL=app-route.js.map//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHJzYykvLi9ub2RlX21vZHVsZXMvbmV4dC9kaXN0L2J1aWxkL3dlYnBhY2svbG9hZGVycy9uZXh0LWFwcC1sb2FkZXIuanM/bmFtZT1hcHAlMkZhcGklMkZyZXBvcnRzJTJGJTVCaWQlNUQlMkZyb3V0ZSZwYWdlPSUyRmFwaSUyRnJlcG9ydHMlMkYlNUJpZCU1RCUyRnJvdXRlJmFwcFBhdGhzPSZwYWdlUGF0aD1wcml2YXRlLW5leHQtYXBwLWRpciUyRmFwaSUyRnJlcG9ydHMlMkYlNUJpZCU1RCUyRnJvdXRlLnRzJmFwcERpcj1EJTNBJTVDUHJvamVjdHMlNUNTY3JpcHRhJTVDZnJvbnRlbmQlNUNzcmMlNUNhcHAmcGFnZUV4dGVuc2lvbnM9dHN4JnBhZ2VFeHRlbnNpb25zPXRzJnBhZ2VFeHRlbnNpb25zPWpzeCZwYWdlRXh0ZW5zaW9ucz1qcyZyb290RGlyPUQlM0ElNUNQcm9qZWN0cyU1Q1NjcmlwdGElNUNmcm9udGVuZCZpc0Rldj10cnVlJnRzY29uZmlnUGF0aD10c2NvbmZpZy5qc29uJmJhc2VQYXRoPSZhc3NldFByZWZpeD0mbmV4dENvbmZpZ091dHB1dD0mcHJlZmVycmVkUmVnaW9uPSZtaWRkbGV3YXJlQ29uZmlnPWUzMCUzRCEiLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7O0FBQXNHO0FBQ3ZDO0FBQ2M7QUFDdUI7QUFDcEc7QUFDQTtBQUNBO0FBQ0Esd0JBQXdCLGdIQUFtQjtBQUMzQztBQUNBLGNBQWMseUVBQVM7QUFDdkI7QUFDQTtBQUNBO0FBQ0E7QUFDQSxLQUFLO0FBQ0w7QUFDQTtBQUNBLFlBQVk7QUFDWixDQUFDO0FBQ0Q7QUFDQTtBQUNBO0FBQ0EsUUFBUSxpRUFBaUU7QUFDekU7QUFDQTtBQUNBLFdBQVcsNEVBQVc7QUFDdEI7QUFDQTtBQUNBLEtBQUs7QUFDTDtBQUN1SDs7QUFFdkgiLCJzb3VyY2VzIjpbIndlYnBhY2s6Ly9zY3JpcHRhLWZyb250ZW5kLz9lMzE3Il0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFwcFJvdXRlUm91dGVNb2R1bGUgfSBmcm9tIFwibmV4dC9kaXN0L3NlcnZlci9mdXR1cmUvcm91dGUtbW9kdWxlcy9hcHAtcm91dGUvbW9kdWxlLmNvbXBpbGVkXCI7XG5pbXBvcnQgeyBSb3V0ZUtpbmQgfSBmcm9tIFwibmV4dC9kaXN0L3NlcnZlci9mdXR1cmUvcm91dGUta2luZFwiO1xuaW1wb3J0IHsgcGF0Y2hGZXRjaCBhcyBfcGF0Y2hGZXRjaCB9IGZyb20gXCJuZXh0L2Rpc3Qvc2VydmVyL2xpYi9wYXRjaC1mZXRjaFwiO1xuaW1wb3J0ICogYXMgdXNlcmxhbmQgZnJvbSBcIkQ6XFxcXFByb2plY3RzXFxcXFNjcmlwdGFcXFxcZnJvbnRlbmRcXFxcc3JjXFxcXGFwcFxcXFxhcGlcXFxccmVwb3J0c1xcXFxbaWRdXFxcXHJvdXRlLnRzXCI7XG4vLyBXZSBpbmplY3QgdGhlIG5leHRDb25maWdPdXRwdXQgaGVyZSBzbyB0aGF0IHdlIGNhbiB1c2UgdGhlbSBpbiB0aGUgcm91dGVcbi8vIG1vZHVsZS5cbmNvbnN0IG5leHRDb25maWdPdXRwdXQgPSBcIlwiXG5jb25zdCByb3V0ZU1vZHVsZSA9IG5ldyBBcHBSb3V0ZVJvdXRlTW9kdWxlKHtcbiAgICBkZWZpbml0aW9uOiB7XG4gICAgICAgIGtpbmQ6IFJvdXRlS2luZC5BUFBfUk9VVEUsXG4gICAgICAgIHBhZ2U6IFwiL2FwaS9yZXBvcnRzL1tpZF0vcm91dGVcIixcbiAgICAgICAgcGF0aG5hbWU6IFwiL2FwaS9yZXBvcnRzL1tpZF1cIixcbiAgICAgICAgZmlsZW5hbWU6IFwicm91dGVcIixcbiAgICAgICAgYnVuZGxlUGF0aDogXCJhcHAvYXBpL3JlcG9ydHMvW2lkXS9yb3V0ZVwiXG4gICAgfSxcbiAgICByZXNvbHZlZFBhZ2VQYXRoOiBcIkQ6XFxcXFByb2plY3RzXFxcXFNjcmlwdGFcXFxcZnJvbnRlbmRcXFxcc3JjXFxcXGFwcFxcXFxhcGlcXFxccmVwb3J0c1xcXFxbaWRdXFxcXHJvdXRlLnRzXCIsXG4gICAgbmV4dENvbmZpZ091dHB1dCxcbiAgICB1c2VybGFuZFxufSk7XG4vLyBQdWxsIG91dCB0aGUgZXhwb3J0cyB0aGF0IHdlIG5lZWQgdG8gZXhwb3NlIGZyb20gdGhlIG1vZHVsZS4gVGhpcyBzaG91bGRcbi8vIGJlIGVsaW1pbmF0ZWQgd2hlbiB3ZSd2ZSBtb3ZlZCB0aGUgb3RoZXIgcm91dGVzIHRvIHRoZSBuZXcgZm9ybWF0LiBUaGVzZVxuLy8gYXJlIHVzZWQgdG8gaG9vayBpbnRvIHRoZSByb3V0ZS5cbmNvbnN0IHsgcmVxdWVzdEFzeW5jU3RvcmFnZSwgc3RhdGljR2VuZXJhdGlvbkFzeW5jU3RvcmFnZSwgc2VydmVySG9va3MgfSA9IHJvdXRlTW9kdWxlO1xuY29uc3Qgb3JpZ2luYWxQYXRobmFtZSA9IFwiL2FwaS9yZXBvcnRzL1tpZF0vcm91dGVcIjtcbmZ1bmN0aW9uIHBhdGNoRmV0Y2goKSB7XG4gICAgcmV0dXJuIF9wYXRjaEZldGNoKHtcbiAgICAgICAgc2VydmVySG9va3MsXG4gICAgICAgIHN0YXRpY0dlbmVyYXRpb25Bc3luY1N0b3JhZ2VcbiAgICB9KTtcbn1cbmV4cG9ydCB7IHJvdXRlTW9kdWxlLCByZXF1ZXN0QXN5bmNTdG9yYWdlLCBzdGF0aWNHZW5lcmF0aW9uQXN5bmNTdG9yYWdlLCBzZXJ2ZXJIb29rcywgb3JpZ2luYWxQYXRobmFtZSwgcGF0Y2hGZXRjaCwgIH07XG5cbi8vIyBzb3VyY2VNYXBwaW5nVVJMPWFwcC1yb3V0ZS5qcy5tYXAiXSwibmFtZXMiOltdLCJzb3VyY2VSb290IjoiIn0=\n//# sourceURL=webpack-internal:///(rsc)/./node_modules/next/dist/build/webpack/loaders/next-app-loader.js?name=app%2Fapi%2Freports%2F%5Bid%5D%2Froute&page=%2Fapi%2Freports%2F%5Bid%5D%2Froute&appPaths=&pagePath=private-next-app-dir%2Fapi%2Freports%2F%5Bid%5D%2Froute.ts&appDir=D%3A%5CProjects%5CScripta%5Cfrontend%5Csrc%5Capp&pageExtensions=tsx&pageExtensions=ts&pageExtensions=jsx&pageExtensions=js&rootDir=D%3A%5CProjects%5CScripta%5Cfrontend&isDev=true&tsconfigPath=tsconfig.json&basePath=&assetPrefix=&nextConfigOutput=&preferredRegion=&middlewareConfig=e30%3D!\n");

/***/ }),

/***/ "(rsc)/./src/app/api/reports/[id]/route.ts":
/*!*******************************************!*\
  !*** ./src/app/api/reports/[id]/route.ts ***!
  \*******************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   GET: () => (/* binding */ GET)\n/* harmony export */ });\n/* harmony import */ var next_server__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! next/server */ \"(rsc)/./node_modules/next/dist/api/server.js\");\n/* harmony import */ var _lib_prisma__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! @/lib/prisma */ \"(rsc)/./src/lib/prisma.ts\");\n/* harmony import */ var _lib_auth__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! @/lib/auth */ \"(rsc)/./src/lib/auth.ts\");\n\n\n\nasync function GET(req, { params }) {\n    try {\n        const user = await (0,_lib_auth__WEBPACK_IMPORTED_MODULE_2__.getCurrentUser)(req);\n        if (!user) {\n            return next_server__WEBPACK_IMPORTED_MODULE_0__.NextResponse.json({\n                error: \"Unauthorized\"\n            }, {\n                status: 401\n            });\n        }\n        const report = await _lib_prisma__WEBPACK_IMPORTED_MODULE_1__.prisma.reportRequest.findUnique({\n            where: {\n                id: params.id\n            },\n            include: {\n                sources: true\n            }\n        });\n        if (!report) {\n            return next_server__WEBPACK_IMPORTED_MODULE_0__.NextResponse.json({\n                error: \"Report not found\"\n            }, {\n                status: 404\n            });\n        }\n        if (report.userId !== user.id) {\n            return next_server__WEBPACK_IMPORTED_MODULE_0__.NextResponse.json({\n                error: \"Forbidden\"\n            }, {\n                status: 403\n            });\n        }\n        return next_server__WEBPACK_IMPORTED_MODULE_0__.NextResponse.json({\n            id: report.id,\n            status: report.status,\n            targetType: report.targetType,\n            ico: report.ico,\n            name: report.name,\n            surname: report.surname,\n            totalCost: report.totalCost,\n            createdAt: report.createdAt,\n            completedAt: report.completedAt,\n            resultUrl: report.resultUrl,\n            sources: report.sources.map((s)=>({\n                    id: s.id,\n                    sourceType: s.sourceType,\n                    status: s.status,\n                    statusMessage: s.statusMessage,\n                    pageCount: s.pageCount,\n                    costCredits: s.costCredits,\n                    findings: s.findings,\n                    createdAt: s.createdAt,\n                    updatedAt: s.updatedAt\n                }))\n        });\n    } catch (error) {\n        console.error(\"GET /api/reports/[id] error\", error);\n        return next_server__WEBPACK_IMPORTED_MODULE_0__.NextResponse.json({\n            error: \"Internal server error\"\n        }, {\n            status: 500\n        });\n    }\n}\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHJzYykvLi9zcmMvYXBwL2FwaS9yZXBvcnRzL1tpZF0vcm91dGUudHMiLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUF3RDtBQUNsQjtBQUNNO0FBRXJDLGVBQWVHLElBQ3BCQyxHQUFnQixFQUNoQixFQUFFQyxNQUFNLEVBQThCO0lBRXRDLElBQUk7UUFDRixNQUFNQyxPQUFPLE1BQU1KLHlEQUFjQSxDQUFDRTtRQUNsQyxJQUFJLENBQUNFLE1BQU07WUFDVCxPQUFPTixxREFBWUEsQ0FBQ08sSUFBSSxDQUFDO2dCQUFFQyxPQUFPO1lBQWUsR0FBRztnQkFBRUMsUUFBUTtZQUFJO1FBQ3BFO1FBRUEsTUFBTUMsU0FBUyxNQUFNVCwrQ0FBTUEsQ0FBQ1UsYUFBYSxDQUFDQyxVQUFVLENBQUM7WUFDbkRDLE9BQU87Z0JBQUVDLElBQUlULE9BQU9TLEVBQUU7WUFBQztZQUN2QkMsU0FBUztnQkFBRUMsU0FBUztZQUFLO1FBQzNCO1FBRUEsSUFBSSxDQUFDTixRQUFRO1lBQ1gsT0FBT1YscURBQVlBLENBQUNPLElBQUksQ0FBQztnQkFBRUMsT0FBTztZQUFtQixHQUFHO2dCQUFFQyxRQUFRO1lBQUk7UUFDeEU7UUFFQSxJQUFJQyxPQUFPTyxNQUFNLEtBQUtYLEtBQUtRLEVBQUUsRUFBRTtZQUM3QixPQUFPZCxxREFBWUEsQ0FBQ08sSUFBSSxDQUFDO2dCQUFFQyxPQUFPO1lBQVksR0FBRztnQkFBRUMsUUFBUTtZQUFJO1FBQ2pFO1FBRUEsT0FBT1QscURBQVlBLENBQUNPLElBQUksQ0FBQztZQUN2Qk8sSUFBSUosT0FBT0ksRUFBRTtZQUNiTCxRQUFRQyxPQUFPRCxNQUFNO1lBQ3JCUyxZQUFZUixPQUFPUSxVQUFVO1lBQzdCQyxLQUFLVCxPQUFPUyxHQUFHO1lBQ2ZDLE1BQU1WLE9BQU9VLElBQUk7WUFDakJDLFNBQVNYLE9BQU9XLE9BQU87WUFDdkJDLFdBQVdaLE9BQU9ZLFNBQVM7WUFDM0JDLFdBQVdiLE9BQU9hLFNBQVM7WUFDM0JDLGFBQWFkLE9BQU9jLFdBQVc7WUFDL0JDLFdBQVdmLE9BQU9lLFNBQVM7WUFDM0JULFNBQVNOLE9BQU9NLE9BQU8sQ0FBQ1UsR0FBRyxDQUFDLENBQUNDLElBQU87b0JBQ2xDYixJQUFJYSxFQUFFYixFQUFFO29CQUNSYyxZQUFZRCxFQUFFQyxVQUFVO29CQUN4Qm5CLFFBQVFrQixFQUFFbEIsTUFBTTtvQkFDaEJvQixlQUFlRixFQUFFRSxhQUFhO29CQUM5QkMsV0FBV0gsRUFBRUcsU0FBUztvQkFDdEJDLGFBQWFKLEVBQUVJLFdBQVc7b0JBQzFCQyxVQUFVTCxFQUFFSyxRQUFRO29CQUNwQlQsV0FBV0ksRUFBRUosU0FBUztvQkFDdEJVLFdBQVdOLEVBQUVNLFNBQVM7Z0JBQ3hCO1FBQ0Y7SUFDRixFQUFFLE9BQU96QixPQUFPO1FBQ2QwQixRQUFRMUIsS0FBSyxDQUFDLCtCQUErQkE7UUFDN0MsT0FBT1IscURBQVlBLENBQUNPLElBQUksQ0FBQztZQUFFQyxPQUFPO1FBQXdCLEdBQUc7WUFBRUMsUUFBUTtRQUFJO0lBQzdFO0FBQ0YiLCJzb3VyY2VzIjpbIndlYnBhY2s6Ly9zY3JpcHRhLWZyb250ZW5kLy4vc3JjL2FwcC9hcGkvcmVwb3J0cy9baWRdL3JvdXRlLnRzP2E4YzkiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgTmV4dFJlcXVlc3QsIE5leHRSZXNwb25zZSB9IGZyb20gXCJuZXh0L3NlcnZlclwiO1xuaW1wb3J0IHsgcHJpc21hIH0gZnJvbSBcIkAvbGliL3ByaXNtYVwiO1xuaW1wb3J0IHsgZ2V0Q3VycmVudFVzZXIgfSBmcm9tIFwiQC9saWIvYXV0aFwiO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gR0VUKFxuICByZXE6IE5leHRSZXF1ZXN0LFxuICB7IHBhcmFtcyB9OiB7IHBhcmFtczogeyBpZDogc3RyaW5nIH0gfVxuKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgdXNlciA9IGF3YWl0IGdldEN1cnJlbnRVc2VyKHJlcSk7XG4gICAgaWYgKCF1c2VyKSB7XG4gICAgICByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oeyBlcnJvcjogXCJVbmF1dGhvcml6ZWRcIiB9LCB7IHN0YXR1czogNDAxIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IHJlcG9ydCA9IGF3YWl0IHByaXNtYS5yZXBvcnRSZXF1ZXN0LmZpbmRVbmlxdWUoe1xuICAgICAgd2hlcmU6IHsgaWQ6IHBhcmFtcy5pZCB9LFxuICAgICAgaW5jbHVkZTogeyBzb3VyY2VzOiB0cnVlIH0sXG4gICAgfSk7XG5cbiAgICBpZiAoIXJlcG9ydCkge1xuICAgICAgcmV0dXJuIE5leHRSZXNwb25zZS5qc29uKHsgZXJyb3I6IFwiUmVwb3J0IG5vdCBmb3VuZFwiIH0sIHsgc3RhdHVzOiA0MDQgfSk7XG4gICAgfVxuXG4gICAgaWYgKHJlcG9ydC51c2VySWQgIT09IHVzZXIuaWQpIHtcbiAgICAgIHJldHVybiBOZXh0UmVzcG9uc2UuanNvbih7IGVycm9yOiBcIkZvcmJpZGRlblwiIH0sIHsgc3RhdHVzOiA0MDMgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIE5leHRSZXNwb25zZS5qc29uKHtcbiAgICAgIGlkOiByZXBvcnQuaWQsXG4gICAgICBzdGF0dXM6IHJlcG9ydC5zdGF0dXMsXG4gICAgICB0YXJnZXRUeXBlOiByZXBvcnQudGFyZ2V0VHlwZSxcbiAgICAgIGljbzogcmVwb3J0LmljbyxcbiAgICAgIG5hbWU6IHJlcG9ydC5uYW1lLFxuICAgICAgc3VybmFtZTogcmVwb3J0LnN1cm5hbWUsXG4gICAgICB0b3RhbENvc3Q6IHJlcG9ydC50b3RhbENvc3QsXG4gICAgICBjcmVhdGVkQXQ6IHJlcG9ydC5jcmVhdGVkQXQsXG4gICAgICBjb21wbGV0ZWRBdDogcmVwb3J0LmNvbXBsZXRlZEF0LFxuICAgICAgcmVzdWx0VXJsOiByZXBvcnQucmVzdWx0VXJsLFxuICAgICAgc291cmNlczogcmVwb3J0LnNvdXJjZXMubWFwKChzKSA9PiAoe1xuICAgICAgICBpZDogcy5pZCxcbiAgICAgICAgc291cmNlVHlwZTogcy5zb3VyY2VUeXBlLFxuICAgICAgICBzdGF0dXM6IHMuc3RhdHVzLFxuICAgICAgICBzdGF0dXNNZXNzYWdlOiBzLnN0YXR1c01lc3NhZ2UsXG4gICAgICAgIHBhZ2VDb3VudDogcy5wYWdlQ291bnQsXG4gICAgICAgIGNvc3RDcmVkaXRzOiBzLmNvc3RDcmVkaXRzLFxuICAgICAgICBmaW5kaW5nczogcy5maW5kaW5ncyxcbiAgICAgICAgY3JlYXRlZEF0OiBzLmNyZWF0ZWRBdCxcbiAgICAgICAgdXBkYXRlZEF0OiBzLnVwZGF0ZWRBdCxcbiAgICAgIH0pKSxcbiAgICB9KTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKFwiR0VUIC9hcGkvcmVwb3J0cy9baWRdIGVycm9yXCIsIGVycm9yKTtcbiAgICByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oeyBlcnJvcjogXCJJbnRlcm5hbCBzZXJ2ZXIgZXJyb3JcIiB9LCB7IHN0YXR1czogNTAwIH0pO1xuICB9XG59XG4iXSwibmFtZXMiOlsiTmV4dFJlc3BvbnNlIiwicHJpc21hIiwiZ2V0Q3VycmVudFVzZXIiLCJHRVQiLCJyZXEiLCJwYXJhbXMiLCJ1c2VyIiwianNvbiIsImVycm9yIiwic3RhdHVzIiwicmVwb3J0IiwicmVwb3J0UmVxdWVzdCIsImZpbmRVbmlxdWUiLCJ3aGVyZSIsImlkIiwiaW5jbHVkZSIsInNvdXJjZXMiLCJ1c2VySWQiLCJ0YXJnZXRUeXBlIiwiaWNvIiwibmFtZSIsInN1cm5hbWUiLCJ0b3RhbENvc3QiLCJjcmVhdGVkQXQiLCJjb21wbGV0ZWRBdCIsInJlc3VsdFVybCIsIm1hcCIsInMiLCJzb3VyY2VUeXBlIiwic3RhdHVzTWVzc2FnZSIsInBhZ2VDb3VudCIsImNvc3RDcmVkaXRzIiwiZmluZGluZ3MiLCJ1cGRhdGVkQXQiLCJjb25zb2xlIl0sInNvdXJjZVJvb3QiOiIifQ==\n//# sourceURL=webpack-internal:///(rsc)/./src/app/api/reports/[id]/route.ts\n");

/***/ }),

/***/ "(rsc)/./src/lib/auth.ts":
/*!*************************!*\
  !*** ./src/lib/auth.ts ***!
  \*************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   authOptions: () => (/* binding */ authOptions),\n/* harmony export */   getCurrentUser: () => (/* binding */ getCurrentUser),\n/* harmony export */   getServerSession: () => (/* binding */ getServerSession)\n/* harmony export */ });\n/* harmony import */ var next_auth__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! next-auth */ \"(rsc)/./node_modules/next-auth/index.js\");\n/* harmony import */ var next_auth__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(next_auth__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var next_auth_providers_credentials__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! next-auth/providers/credentials */ \"(rsc)/./node_modules/next-auth/providers/credentials.js\");\n/* harmony import */ var bcryptjs__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! bcryptjs */ \"(rsc)/./node_modules/bcryptjs/index.js\");\n/* harmony import */ var bcryptjs__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(bcryptjs__WEBPACK_IMPORTED_MODULE_2__);\n/* harmony import */ var _lib_prisma__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! @/lib/prisma */ \"(rsc)/./src/lib/prisma.ts\");\n\n\n\n\n// ─── Auth Options ─────────────────────────────────────────────────────────────\nconst authOptions = {\n    secret: process.env.NEXTAUTH_SECRET,\n    session: {\n        strategy: \"jwt\"\n    },\n    providers: [\n        (0,next_auth_providers_credentials__WEBPACK_IMPORTED_MODULE_1__[\"default\"])({\n            name: \"Credentials\",\n            credentials: {\n                email: {\n                    label: \"Email\",\n                    type: \"email\"\n                },\n                password: {\n                    label: \"Password\",\n                    type: \"password\"\n                }\n            },\n            async authorize (credentials) {\n                if (!credentials?.email || !credentials?.password) {\n                    return null;\n                }\n                const user = await _lib_prisma__WEBPACK_IMPORTED_MODULE_3__.prisma.user.findUnique({\n                    where: {\n                        email: credentials.email\n                    }\n                });\n                if (!user || !user.passwordHash) {\n                    return null;\n                }\n                const isValid = await bcryptjs__WEBPACK_IMPORTED_MODULE_2___default().compare(credentials.password, user.passwordHash);\n                if (!isValid) {\n                    return null;\n                }\n                // Ensure the user has a Wallet — create atomically if missing.\n                const existingWallet = await _lib_prisma__WEBPACK_IMPORTED_MODULE_3__.prisma.wallet.findUnique({\n                    where: {\n                        userId: user.id\n                    }\n                });\n                if (!existingWallet) {\n                    await _lib_prisma__WEBPACK_IMPORTED_MODULE_3__.prisma.wallet.create({\n                        data: {\n                            userId: user.id\n                        }\n                    });\n                }\n                return {\n                    id: user.id,\n                    email: user.email,\n                    name: user.name\n                };\n            }\n        })\n    ],\n    callbacks: {\n        async jwt ({ token, user }) {\n            // `user` is only available on sign-in; persist id into token.\n            if (user) {\n                token.id = user.id;\n            }\n            return token;\n        },\n        async session ({ session, token }) {\n            // Expose id in the session object.\n            if (session.user) {\n                session.user.id = token.id;\n            }\n            return session;\n        }\n    },\n    pages: {\n        signIn: \"/login\"\n    }\n};\n// ─── Helpers ──────────────────────────────────────────────────────────────────\n/**\n * Wrapper around getServerSession that injects authOptions automatically.\n * Use in Server Components:  const session = await getServerSession();\n */ async function getServerSession() {\n    return (0,next_auth__WEBPACK_IMPORTED_MODULE_0__.getServerSession)(authOptions);\n}\n/**\n * Auth check for App Router route handlers.\n * Returns the authenticated user or null.\n *\n * @example\n * const user = await getCurrentUser(req);\n * if (!user) return NextResponse.json({ error: \"Unauthorized\" }, { status: 401 });\n */ async function getCurrentUser(_req) {\n    const session = await (0,next_auth__WEBPACK_IMPORTED_MODULE_0__.getServerSession)(authOptions);\n    if (!session?.user?.id) return null;\n    return session.user;\n}\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHJzYykvLi9zcmMvbGliL2F1dGgudHMiLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7O0FBQTBGO0FBQ3hCO0FBQ3BDO0FBRVE7QUE0QnRDLGlGQUFpRjtBQUUxRSxNQUFNSyxjQUErQjtJQUMxQ0MsUUFBUUMsUUFBUUMsR0FBRyxDQUFDQyxlQUFlO0lBRW5DQyxTQUFTO1FBQ1BDLFVBQVU7SUFDWjtJQUVBQyxXQUFXO1FBQ1RWLDJFQUFtQkEsQ0FBQztZQUNsQlcsTUFBTTtZQUNOQyxhQUFhO2dCQUNYQyxPQUFPO29CQUFFQyxPQUFPO29CQUFTQyxNQUFNO2dCQUFRO2dCQUN2Q0MsVUFBVTtvQkFBRUYsT0FBTztvQkFBWUMsTUFBTTtnQkFBVztZQUNsRDtZQUNBLE1BQU1FLFdBQVVMLFdBQVc7Z0JBQ3pCLElBQUksQ0FBQ0EsYUFBYUMsU0FBUyxDQUFDRCxhQUFhSSxVQUFVO29CQUNqRCxPQUFPO2dCQUNUO2dCQUVBLE1BQU1FLE9BQU8sTUFBTWhCLCtDQUFNQSxDQUFDZ0IsSUFBSSxDQUFDQyxVQUFVLENBQUM7b0JBQ3hDQyxPQUFPO3dCQUFFUCxPQUFPRCxZQUFZQyxLQUFLO29CQUFDO2dCQUNwQztnQkFFQSxJQUFJLENBQUNLLFFBQVEsQ0FBQ0EsS0FBS0csWUFBWSxFQUFFO29CQUMvQixPQUFPO2dCQUNUO2dCQUVBLE1BQU1DLFVBQVUsTUFBTXJCLHVEQUFjLENBQUNXLFlBQVlJLFFBQVEsRUFBRUUsS0FBS0csWUFBWTtnQkFDNUUsSUFBSSxDQUFDQyxTQUFTO29CQUNaLE9BQU87Z0JBQ1Q7Z0JBRUEsK0RBQStEO2dCQUMvRCxNQUFNRSxpQkFBaUIsTUFBTXRCLCtDQUFNQSxDQUFDdUIsTUFBTSxDQUFDTixVQUFVLENBQUM7b0JBQ3BEQyxPQUFPO3dCQUFFTSxRQUFRUixLQUFLUyxFQUFFO29CQUFDO2dCQUMzQjtnQkFFQSxJQUFJLENBQUNILGdCQUFnQjtvQkFDbkIsTUFBTXRCLCtDQUFNQSxDQUFDdUIsTUFBTSxDQUFDRyxNQUFNLENBQUM7d0JBQ3pCQyxNQUFNOzRCQUFFSCxRQUFRUixLQUFLUyxFQUFFO3dCQUFDO29CQUMxQjtnQkFDRjtnQkFFQSxPQUFPO29CQUNMQSxJQUFJVCxLQUFLUyxFQUFFO29CQUNYZCxPQUFPSyxLQUFLTCxLQUFLO29CQUNqQkYsTUFBTU8sS0FBS1AsSUFBSTtnQkFDakI7WUFDRjtRQUNGO0tBQ0Q7SUFFRG1CLFdBQVc7UUFDVCxNQUFNQyxLQUFJLEVBQUVDLEtBQUssRUFBRWQsSUFBSSxFQUFFO1lBQ3ZCLDhEQUE4RDtZQUM5RCxJQUFJQSxNQUFNO2dCQUNSYyxNQUFNTCxFQUFFLEdBQUdULEtBQUtTLEVBQUU7WUFDcEI7WUFDQSxPQUFPSztRQUNUO1FBRUEsTUFBTXhCLFNBQVEsRUFBRUEsT0FBTyxFQUFFd0IsS0FBSyxFQUFFO1lBQzlCLG1DQUFtQztZQUNuQyxJQUFJeEIsUUFBUVUsSUFBSSxFQUFFO2dCQUNoQlYsUUFBUVUsSUFBSSxDQUFDUyxFQUFFLEdBQUdLLE1BQU1MLEVBQUU7WUFDNUI7WUFDQSxPQUFPbkI7UUFDVDtJQUNGO0lBRUF5QixPQUFPO1FBQ0xDLFFBQVE7SUFDVjtBQUNGLEVBQUU7QUFFRixpRkFBaUY7QUFFakY7OztDQUdDLEdBQ00sZUFBZXBDO0lBQ3BCLE9BQU9DLDJEQUF3QkEsQ0FBQ0k7QUFDbEM7QUFFQTs7Ozs7OztDQU9DLEdBQ00sZUFBZWdDLGVBQWVDLElBQWlCO0lBQ3BELE1BQU01QixVQUFVLE1BQU1ULDJEQUF3QkEsQ0FBQ0k7SUFDL0MsSUFBSSxDQUFDSyxTQUFTVSxNQUFNUyxJQUFJLE9BQU87SUFDL0IsT0FBT25CLFFBQVFVLElBQUk7QUFDckIiLCJzb3VyY2VzIjpbIndlYnBhY2s6Ly9zY3JpcHRhLWZyb250ZW5kLy4vc3JjL2xpYi9hdXRoLnRzPzY2OTIiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgTmV4dEF1dGhPcHRpb25zLCBnZXRTZXJ2ZXJTZXNzaW9uIGFzIG5leHRBdXRoR2V0U2VydmVyU2Vzc2lvbiB9IGZyb20gXCJuZXh0LWF1dGhcIjtcbmltcG9ydCBDcmVkZW50aWFsc1Byb3ZpZGVyIGZyb20gXCJuZXh0LWF1dGgvcHJvdmlkZXJzL2NyZWRlbnRpYWxzXCI7XG5pbXBvcnQgYmNyeXB0IGZyb20gXCJiY3J5cHRqc1wiO1xuaW1wb3J0IHsgTmV4dFJlcXVlc3QgfSBmcm9tIFwibmV4dC9zZXJ2ZXJcIjtcbmltcG9ydCB7IHByaXNtYSB9IGZyb20gXCJAL2xpYi9wcmlzbWFcIjtcblxuLy8g4pSA4pSA4pSAIFR5cGVzIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG5leHBvcnQgdHlwZSBBdXRoVXNlciA9IHtcbiAgaWQ6IHN0cmluZztcbiAgZW1haWw6IHN0cmluZztcbiAgbmFtZT86IHN0cmluZyB8IG51bGw7XG59O1xuXG4vLyBBdWdtZW50IG5leHQtYXV0aCB0eXBlcyBzbyBzZXNzaW9uLnVzZXIuaWQgaXMgYXZhaWxhYmxlIHdpdGggZnVsbCB0eXBpbmcuXG5kZWNsYXJlIG1vZHVsZSBcIm5leHQtYXV0aFwiIHtcbiAgaW50ZXJmYWNlIFNlc3Npb24ge1xuICAgIHVzZXI6IEF1dGhVc2VyO1xuICB9XG4gIGludGVyZmFjZSBVc2VyIHtcbiAgICBpZDogc3RyaW5nO1xuICAgIGVtYWlsOiBzdHJpbmc7XG4gICAgbmFtZT86IHN0cmluZyB8IG51bGw7XG4gIH1cbn1cblxuZGVjbGFyZSBtb2R1bGUgXCJuZXh0LWF1dGgvand0XCIge1xuICBpbnRlcmZhY2UgSldUIHtcbiAgICBpZDogc3RyaW5nO1xuICB9XG59XG5cbi8vIOKUgOKUgOKUgCBBdXRoIE9wdGlvbnMg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbmV4cG9ydCBjb25zdCBhdXRoT3B0aW9uczogTmV4dEF1dGhPcHRpb25zID0ge1xuICBzZWNyZXQ6IHByb2Nlc3MuZW52Lk5FWFRBVVRIX1NFQ1JFVCxcblxuICBzZXNzaW9uOiB7XG4gICAgc3RyYXRlZ3k6IFwiand0XCIsXG4gIH0sXG5cbiAgcHJvdmlkZXJzOiBbXG4gICAgQ3JlZGVudGlhbHNQcm92aWRlcih7XG4gICAgICBuYW1lOiBcIkNyZWRlbnRpYWxzXCIsXG4gICAgICBjcmVkZW50aWFsczoge1xuICAgICAgICBlbWFpbDogeyBsYWJlbDogXCJFbWFpbFwiLCB0eXBlOiBcImVtYWlsXCIgfSxcbiAgICAgICAgcGFzc3dvcmQ6IHsgbGFiZWw6IFwiUGFzc3dvcmRcIiwgdHlwZTogXCJwYXNzd29yZFwiIH0sXG4gICAgICB9LFxuICAgICAgYXN5bmMgYXV0aG9yaXplKGNyZWRlbnRpYWxzKSB7XG4gICAgICAgIGlmICghY3JlZGVudGlhbHM/LmVtYWlsIHx8ICFjcmVkZW50aWFscz8ucGFzc3dvcmQpIHtcbiAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHVzZXIgPSBhd2FpdCBwcmlzbWEudXNlci5maW5kVW5pcXVlKHtcbiAgICAgICAgICB3aGVyZTogeyBlbWFpbDogY3JlZGVudGlhbHMuZW1haWwgfSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKCF1c2VyIHx8ICF1c2VyLnBhc3N3b3JkSGFzaCkge1xuICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgaXNWYWxpZCA9IGF3YWl0IGJjcnlwdC5jb21wYXJlKGNyZWRlbnRpYWxzLnBhc3N3b3JkLCB1c2VyLnBhc3N3b3JkSGFzaCk7XG4gICAgICAgIGlmICghaXNWYWxpZCkge1xuICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRW5zdXJlIHRoZSB1c2VyIGhhcyBhIFdhbGxldCDigJQgY3JlYXRlIGF0b21pY2FsbHkgaWYgbWlzc2luZy5cbiAgICAgICAgY29uc3QgZXhpc3RpbmdXYWxsZXQgPSBhd2FpdCBwcmlzbWEud2FsbGV0LmZpbmRVbmlxdWUoe1xuICAgICAgICAgIHdoZXJlOiB7IHVzZXJJZDogdXNlci5pZCB9LFxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAoIWV4aXN0aW5nV2FsbGV0KSB7XG4gICAgICAgICAgYXdhaXQgcHJpc21hLndhbGxldC5jcmVhdGUoe1xuICAgICAgICAgICAgZGF0YTogeyB1c2VySWQ6IHVzZXIuaWQgfSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgaWQ6IHVzZXIuaWQsXG4gICAgICAgICAgZW1haWw6IHVzZXIuZW1haWwsXG4gICAgICAgICAgbmFtZTogdXNlci5uYW1lLFxuICAgICAgICB9O1xuICAgICAgfSxcbiAgICB9KSxcbiAgXSxcblxuICBjYWxsYmFja3M6IHtcbiAgICBhc3luYyBqd3QoeyB0b2tlbiwgdXNlciB9KSB7XG4gICAgICAvLyBgdXNlcmAgaXMgb25seSBhdmFpbGFibGUgb24gc2lnbi1pbjsgcGVyc2lzdCBpZCBpbnRvIHRva2VuLlxuICAgICAgaWYgKHVzZXIpIHtcbiAgICAgICAgdG9rZW4uaWQgPSB1c2VyLmlkO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRva2VuO1xuICAgIH0sXG5cbiAgICBhc3luYyBzZXNzaW9uKHsgc2Vzc2lvbiwgdG9rZW4gfSkge1xuICAgICAgLy8gRXhwb3NlIGlkIGluIHRoZSBzZXNzaW9uIG9iamVjdC5cbiAgICAgIGlmIChzZXNzaW9uLnVzZXIpIHtcbiAgICAgICAgc2Vzc2lvbi51c2VyLmlkID0gdG9rZW4uaWQ7XG4gICAgICB9XG4gICAgICByZXR1cm4gc2Vzc2lvbjtcbiAgICB9LFxuICB9LFxuXG4gIHBhZ2VzOiB7XG4gICAgc2lnbkluOiBcIi9sb2dpblwiLFxuICB9LFxufTtcblxuLy8g4pSA4pSA4pSAIEhlbHBlcnMg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbi8qKlxuICogV3JhcHBlciBhcm91bmQgZ2V0U2VydmVyU2Vzc2lvbiB0aGF0IGluamVjdHMgYXV0aE9wdGlvbnMgYXV0b21hdGljYWxseS5cbiAqIFVzZSBpbiBTZXJ2ZXIgQ29tcG9uZW50czogIGNvbnN0IHNlc3Npb24gPSBhd2FpdCBnZXRTZXJ2ZXJTZXNzaW9uKCk7XG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZXRTZXJ2ZXJTZXNzaW9uKCkge1xuICByZXR1cm4gbmV4dEF1dGhHZXRTZXJ2ZXJTZXNzaW9uKGF1dGhPcHRpb25zKTtcbn1cblxuLyoqXG4gKiBBdXRoIGNoZWNrIGZvciBBcHAgUm91dGVyIHJvdXRlIGhhbmRsZXJzLlxuICogUmV0dXJucyB0aGUgYXV0aGVudGljYXRlZCB1c2VyIG9yIG51bGwuXG4gKlxuICogQGV4YW1wbGVcbiAqIGNvbnN0IHVzZXIgPSBhd2FpdCBnZXRDdXJyZW50VXNlcihyZXEpO1xuICogaWYgKCF1c2VyKSByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oeyBlcnJvcjogXCJVbmF1dGhvcml6ZWRcIiB9LCB7IHN0YXR1czogNDAxIH0pO1xuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2V0Q3VycmVudFVzZXIoX3JlcTogTmV4dFJlcXVlc3QpOiBQcm9taXNlPEF1dGhVc2VyIHwgbnVsbD4ge1xuICBjb25zdCBzZXNzaW9uID0gYXdhaXQgbmV4dEF1dGhHZXRTZXJ2ZXJTZXNzaW9uKGF1dGhPcHRpb25zKTtcbiAgaWYgKCFzZXNzaW9uPy51c2VyPy5pZCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiBzZXNzaW9uLnVzZXIgYXMgQXV0aFVzZXI7XG59XG4iXSwibmFtZXMiOlsiZ2V0U2VydmVyU2Vzc2lvbiIsIm5leHRBdXRoR2V0U2VydmVyU2Vzc2lvbiIsIkNyZWRlbnRpYWxzUHJvdmlkZXIiLCJiY3J5cHQiLCJwcmlzbWEiLCJhdXRoT3B0aW9ucyIsInNlY3JldCIsInByb2Nlc3MiLCJlbnYiLCJORVhUQVVUSF9TRUNSRVQiLCJzZXNzaW9uIiwic3RyYXRlZ3kiLCJwcm92aWRlcnMiLCJuYW1lIiwiY3JlZGVudGlhbHMiLCJlbWFpbCIsImxhYmVsIiwidHlwZSIsInBhc3N3b3JkIiwiYXV0aG9yaXplIiwidXNlciIsImZpbmRVbmlxdWUiLCJ3aGVyZSIsInBhc3N3b3JkSGFzaCIsImlzVmFsaWQiLCJjb21wYXJlIiwiZXhpc3RpbmdXYWxsZXQiLCJ3YWxsZXQiLCJ1c2VySWQiLCJpZCIsImNyZWF0ZSIsImRhdGEiLCJjYWxsYmFja3MiLCJqd3QiLCJ0b2tlbiIsInBhZ2VzIiwic2lnbkluIiwiZ2V0Q3VycmVudFVzZXIiLCJfcmVxIl0sInNvdXJjZVJvb3QiOiIifQ==\n//# sourceURL=webpack-internal:///(rsc)/./src/lib/auth.ts\n");

/***/ }),

/***/ "(rsc)/./src/lib/prisma.ts":
/*!***************************!*\
  !*** ./src/lib/prisma.ts ***!
  \***************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   prisma: () => (/* binding */ prisma)\n/* harmony export */ });\n/* harmony import */ var _prisma_client__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! @prisma/client */ \"@prisma/client\");\n/* harmony import */ var _prisma_client__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_prisma_client__WEBPACK_IMPORTED_MODULE_0__);\n\nconst globalForPrisma = globalThis;\nconst prisma = globalForPrisma.prisma ?? new _prisma_client__WEBPACK_IMPORTED_MODULE_0__.PrismaClient();\nif (true) {\n    globalForPrisma.prisma = prisma;\n}\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHJzYykvLi9zcmMvbGliL3ByaXNtYS50cyIsIm1hcHBpbmdzIjoiOzs7Ozs7QUFBOEM7QUFFOUMsTUFBTUMsa0JBQWtCQztBQUVqQixNQUFNQyxTQUFTRixnQkFBZ0JFLE1BQU0sSUFBSSxJQUFJSCx3REFBWUEsR0FBRztBQUVuRSxJQUFJSSxJQUFxQyxFQUFFO0lBQ3pDSCxnQkFBZ0JFLE1BQU0sR0FBR0E7QUFDM0IiLCJzb3VyY2VzIjpbIndlYnBhY2s6Ly9zY3JpcHRhLWZyb250ZW5kLy4vc3JjL2xpYi9wcmlzbWEudHM/MDFkNyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBQcmlzbWFDbGllbnQgfSBmcm9tIFwiQHByaXNtYS9jbGllbnRcIjtcblxuY29uc3QgZ2xvYmFsRm9yUHJpc21hID0gZ2xvYmFsVGhpcyBhcyB1bmtub3duIGFzIHsgcHJpc21hPzogUHJpc21hQ2xpZW50IH07XG5cbmV4cG9ydCBjb25zdCBwcmlzbWEgPSBnbG9iYWxGb3JQcmlzbWEucHJpc21hID8/IG5ldyBQcmlzbWFDbGllbnQoKTtcblxuaWYgKHByb2Nlc3MuZW52Lk5PREVfRU5WICE9PSBcInByb2R1Y3Rpb25cIikge1xuICBnbG9iYWxGb3JQcmlzbWEucHJpc21hID0gcHJpc21hO1xufVxuIl0sIm5hbWVzIjpbIlByaXNtYUNsaWVudCIsImdsb2JhbEZvclByaXNtYSIsImdsb2JhbFRoaXMiLCJwcmlzbWEiLCJwcm9jZXNzIl0sInNvdXJjZVJvb3QiOiIifQ==\n//# sourceURL=webpack-internal:///(rsc)/./src/lib/prisma.ts\n");

/***/ })

};
;

// load runtime
var __webpack_require__ = require("../../../../webpack-runtime.js");
__webpack_require__.C(exports);
var __webpack_exec__ = (moduleId) => (__webpack_require__(__webpack_require__.s = moduleId))
var __webpack_exports__ = __webpack_require__.X(0, ["vendor-chunks/next","vendor-chunks/next-auth","vendor-chunks/@babel","vendor-chunks/jose","vendor-chunks/openid-client","vendor-chunks/bcryptjs","vendor-chunks/oauth","vendor-chunks/preact","vendor-chunks/uuid","vendor-chunks/yallist","vendor-chunks/preact-render-to-string","vendor-chunks/lru-cache","vendor-chunks/cookie","vendor-chunks/oidc-token-hash","vendor-chunks/@panva"], () => (__webpack_exec__("(rsc)/./node_modules/next/dist/build/webpack/loaders/next-app-loader.js?name=app%2Fapi%2Freports%2F%5Bid%5D%2Froute&page=%2Fapi%2Freports%2F%5Bid%5D%2Froute&appPaths=&pagePath=private-next-app-dir%2Fapi%2Freports%2F%5Bid%5D%2Froute.ts&appDir=D%3A%5CProjects%5CScripta%5Cfrontend%5Csrc%5Capp&pageExtensions=tsx&pageExtensions=ts&pageExtensions=jsx&pageExtensions=js&rootDir=D%3A%5CProjects%5CScripta%5Cfrontend&isDev=true&tsconfigPath=tsconfig.json&basePath=&assetPrefix=&nextConfigOutput=&preferredRegion=&middlewareConfig=e30%3D!")));
module.exports = __webpack_exports__;

})();