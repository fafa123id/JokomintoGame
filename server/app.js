import express from "express";
import cookieParser from "cookie-parser";
import config from "./config/index.js";
import { securityHeaders } from "./middlewares/security.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import apiRoutes from "./routes/api.routes.js";
import webRoutes from "./routes/web.routes.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", config.trustProxy);

  app.use(securityHeaders);
  app.use(express.json({ limit: "10kb" }));
  app.use(cookieParser());

  app.use("/api", apiRoutes);
  app.use(webRoutes);

  app.use((req, res) => res.status(404).type("text").send("Not found"));
  app.use(errorHandler);

  return app;
}
