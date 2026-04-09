import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/weather", async (_req, res): Promise<void> => {
  const today = new Date();
  const days = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

  const weather = [
    {
      date: today.toISOString().split("T")[0],
      dayName: "Hoy",
      condition: "Parcialmente nublado",
      conditionIcon: "cloud-sun",
      tempMin: 8,
      tempMax: 18,
      rainProbability: 20,
      windSpeed: 25,
      windDirection: "NO",
    },
    {
      date: new Date(today.getTime() + 86400000).toISOString().split("T")[0],
      dayName: days[(today.getDay() + 1) % 7],
      condition: "Soleado",
      conditionIcon: "sun",
      tempMin: 10,
      tempMax: 22,
      rainProbability: 5,
      windSpeed: 18,
      windDirection: "O",
    },
    {
      date: new Date(today.getTime() + 172800000).toISOString().split("T")[0],
      dayName: days[(today.getDay() + 2) % 7],
      condition: "Lluvioso",
      conditionIcon: "cloud-rain",
      tempMin: 6,
      tempMax: 14,
      rainProbability: 75,
      windSpeed: 35,
      windDirection: "S",
    },
  ];

  res.json(weather);
});

export default router;
