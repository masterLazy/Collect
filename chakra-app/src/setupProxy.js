const { createProxyMiddleware } = require("http-proxy-middleware");

// CRA's dev server proxies /api/* requests to the ASP.NET Core backend.
// The target port is read from REACT_APP_API_PORT (default 5000).
// This lets you use relative URLs in the frontend during development.

const target = `http://localhost:${process.env.REACT_APP_API_PORT || "5000"}`;

module.exports = function (app) {
    app.use(
        "/api",
        createProxyMiddleware({
            target,
            changeOrigin: true,
        })
    );
};
