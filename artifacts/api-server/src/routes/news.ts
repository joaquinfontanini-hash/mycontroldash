import { Router, type IRouter } from "express";
import { ListNewsQueryParams } from "@workspace/api-zod";

const MOCK_NEWS = [
  {
    id: 1,
    title: "El gobierno anuncia nuevo paquete de medidas para contener la inflación",
    source: "Infobae",
    category: "nacionales",
    date: new Date().toISOString(),
    summary: "El Ejecutivo presentó un conjunto de medidas orientadas a reducir la presión inflacionaria, incluyendo acuerdos de precios con principales cadenas de supermercados y medidas fiscales complementarias.",
    url: "https://www.infobae.com",
    imageUrl: null,
  },
  {
    id: 2,
    title: "AFIP prorroga el vencimiento de obligaciones impositivas para PyMEs",
    source: "La Nacion",
    category: "impuestos",
    date: new Date(Date.now() - 3600000).toISOString(),
    summary: "La Administración Federal de Ingresos Públicos extendió los plazos de presentación de declaraciones juradas para pequeñas y medianas empresas, según resolución general publicada hoy.",
    url: "https://www.lanacion.com.ar",
    imageUrl: null,
  },
  {
    id: 3,
    title: "Neuquén registra crecimiento en inversiones del sector energético",
    source: "Neuquén Informa",
    category: "provinciales",
    date: new Date(Date.now() - 7200000).toISOString(),
    summary: "La provincia de Neuquén reportó un incremento del 18% en inversiones del sector energético durante el primer trimestre, impulsado principalmente por proyectos de Vaca Muerta.",
    url: "https://www.neuqueninforma.gob.ar",
    imageUrl: null,
  },
  {
    id: 4,
    title: "El dólar blue cierra semana en máximos del año",
    source: "Ambito",
    category: "economia",
    date: new Date(Date.now() - 10800000).toISOString(),
    summary: "El tipo de cambio informal alcanzó niveles no vistos desde comienzos de año, reflejando tensiones en el mercado cambiario ante las expectativas de ajuste de tarifas.",
    url: "https://www.ambito.com",
    imageUrl: null,
  },
  {
    id: 5,
    title: "Cámara de Comercio promueve acuerdos bilaterales con Brasil para sector agroindustrial",
    source: "El Cronista",
    category: "negocios",
    date: new Date(Date.now() - 14400000).toISOString(),
    summary: "Representantes del sector empresarial argentino se reunieron con sus pares brasileños para establecer nuevos marcos de cooperación en exportaciones agroindustriales.",
    url: "https://www.cronista.com",
    imageUrl: null,
  },
  {
    id: 6,
    title: "Se actualizan los valores de la RG 5616 sobre retenciones de IVA",
    source: "AFIP",
    category: "impuestos",
    date: new Date(Date.now() - 18000000).toISOString(),
    summary: "La AFIP publicó la actualización de los montos mínimos para la aplicación del régimen de retenciones del IVA, con vigencia a partir del mes próximo.",
    url: "https://www.afip.gob.ar",
    imageUrl: null,
  },
  {
    id: 7,
    title: "Exportaciones patagónicas crecen un 12% interanual en el primer trimestre",
    source: "Diario Río Negro",
    category: "provinciales",
    date: new Date(Date.now() - 21600000).toISOString(),
    summary: "Los datos del INDEC muestran una performance positiva de las exportaciones de la región patagónica, lideradas por frutas, petróleo y gas natural.",
    url: "https://www.rionegro.com.ar",
    imageUrl: null,
  },
  {
    id: 8,
    title: "Reservas del BCRA cierran semana con leve recuperación",
    source: "Clarín",
    category: "economia",
    date: new Date(Date.now() - 25200000).toISOString(),
    summary: "El Banco Central logró sumar divisas por operaciones de compra en el mercado cambiario oficial, cerrando la semana con reservas brutas por encima de los USD 28.000 millones.",
    url: "https://www.clarin.com",
    imageUrl: null,
  },
];

const router: IRouter = Router();

router.get("/news", async (req, res): Promise<void> => {
  const query = ListNewsQueryParams.safeParse(req.query);
  let news = [...MOCK_NEWS];

  if (query.success) {
    if (query.data.category) {
      news = news.filter((n) => n.category === query.data.category);
    }
    if (query.data.limit) {
      news = news.slice(0, query.data.limit);
    }
  }

  res.json(news);
});

export default router;
