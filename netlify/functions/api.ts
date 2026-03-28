import express, { type Request, Response, NextFunction } from "express";
import serverless from "serverless-http";
import { registerRoutes } from "../../server/routes";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);

app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: false }));

app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const path = req.path;
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      console.log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });
  next();
});

// Strip the /api prefix added by Netlify redirect
app.use((req: Request, _res: Response, next: NextFunction) => {
  if (req.path.startsWith("/api/")) {
    req.url = req.url.replace(/^\/api/, "");
  }
  next();
});

let initialized = false;

async function initApp() {
  if (!initialized) {
    await registerRoutes(httpServer, app);
    app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      if (res.headersSent) return next(err);
      res.status(status).json({ message });
    });
    initialized = true;
  }
}

export const handler = async (event: any, context: any) => {
  await initApp();
  const serverlessHandler = serverless(app, {
    binary: ['multipart/form-data', 'application/octet-stream', '*/*']
  });
  return serverlessHandler(event, context);
};
