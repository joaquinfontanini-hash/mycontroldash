import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tasksRouter from "./tasks";
import shortcutsRouter from "./shortcuts";
import fiscalRouter from "./fiscal";
import travelRouter from "./travel";
import newsRouter from "./news";
import emailsRouter from "./emails";
import weatherRouter from "./weather";
import settingsRouter from "./settings";
import usersRouter from "./users";
import dashboardRouter from "./dashboard";
import syncRouter from "./sync";
import currencyRouter from "./currency";
import dueDatesRouter from "./due-dates";
import externalSourcesRouter from "./external-sources";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(tasksRouter);
router.use(shortcutsRouter);
router.use(fiscalRouter);
router.use(travelRouter);
router.use(newsRouter);
router.use(emailsRouter);
router.use(weatherRouter);
router.use(settingsRouter);
router.use(usersRouter);
router.use(syncRouter);
router.use(currencyRouter);
router.use(dueDatesRouter);
router.use(externalSourcesRouter);

export default router;
