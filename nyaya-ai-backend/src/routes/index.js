import { Router } from "express";
import healthRoutes from "./health.routes.js";
import caseRoutes from "./case.routes.js";
import legalRoutes from "./legal.routes.js";
import documentRoutes from "./document.routes.js";

const apiRouter = Router();

apiRouter.use("/", healthRoutes);
apiRouter.use("/cases", caseRoutes);
apiRouter.use("/legal", legalRoutes);
apiRouter.use("/documents", documentRoutes);

export default apiRouter;
