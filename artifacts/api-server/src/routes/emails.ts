import { Router, type IRouter } from "express";
import { ListEmailsQueryParams } from "@workspace/api-zod";

const MOCK_EMAILS = [
  {
    id: 1,
    sender: "Carlos Mendoza",
    senderEmail: "carlos.mendoza@consultora.com.ar",
    subject: "Informe anual de auditoría - Revisión final",
    preview: "Adjunto el borrador final del informe de auditoría para su revisión. Por favor confirme si hay observaciones antes del viernes.",
    date: new Date(Date.now() - 1800000).toISOString(),
    isRead: false,
    category: "trabajo",
  },
  {
    id: 2,
    sender: "AFIP Notificaciones",
    senderEmail: "notificaciones@afip.gob.ar",
    subject: "Notificación: Vencimiento declaración jurada IVA",
    preview: "Le informamos que el próximo vencimiento para la presentación de la declaración jurada de IVA es el 18 del corriente mes.",
    date: new Date(Date.now() - 3600000).toISOString(),
    isRead: false,
    category: "impuestos",
  },
  {
    id: 3,
    sender: "Lucía Rodríguez",
    senderEmail: "lucia@clienteempresa.com",
    subject: "Re: Propuesta de servicios profesionales",
    preview: "Muchas gracias por la propuesta. Nos pareció interesante y quisiera coordinar una reunión para discutir los detalles del alcance.",
    date: new Date(Date.now() - 7200000).toISOString(),
    isRead: true,
    category: "clientes",
  },
  {
    id: 4,
    sender: "Banco Nación Argentina",
    senderEmail: "alertas@bna.com.ar",
    subject: "Alerta: Transferencia recibida por $450.000",
    preview: "Se acreditó en su cuenta una transferencia de $450.000 proveniente de EMPRESA SA. Saldo actualizado disponible en homebanking.",
    date: new Date(Date.now() - 10800000).toISOString(),
    isRead: true,
    category: "finanzas",
  },
  {
    id: 5,
    sender: "Marcos Villanueva",
    senderEmail: "marcos.v@proveedor.com",
    subject: "Factura B 0001-00003412 - Servicios Marzo",
    preview: "Estimado cliente, le remitimos la factura correspondiente a los servicios de marzo. El importe total es de $185.000 con vencimiento el 30 del corriente.",
    date: new Date(Date.now() - 14400000).toISOString(),
    isRead: false,
    category: "facturacion",
  },
  {
    id: 6,
    sender: "Consejo Profesional de CABA",
    senderEmail: "info@cgce.org.ar",
    subject: "Capacitación: Nuevas resoluciones técnicas - Inscripción abierta",
    preview: "Le informamos que se encuentran abiertas las inscripciones para el curso de actualización sobre las últimas resoluciones técnicas aprobadas.",
    date: new Date(Date.now() - 18000000).toISOString(),
    isRead: true,
    category: "capacitacion",
  },
  {
    id: 7,
    sender: "Ana García",
    senderEmail: "ana.garcia@socio.com.ar",
    subject: "Reunión de socios - Agenda para el lunes",
    preview: "Les comparto la agenda propuesta para la reunión del lunes 14. Los puntos principales son la aprobación del presupuesto y la incorporación de nuevos clientes.",
    date: new Date(Date.now() - 21600000).toISOString(),
    isRead: false,
    category: "trabajo",
  },
  {
    id: 8,
    sender: "Rentas Neuquén",
    senderEmail: "notificaciones@rentas.neuquen.gov.ar",
    subject: "Recordatorio: Vencimiento Ingresos Brutos",
    preview: "Se le recuerda que el vencimiento para el pago del anticipo mensual de Ingresos Brutos correspondiente al período actual opera el próximo día 20.",
    date: new Date(Date.now() - 25200000).toISOString(),
    isRead: true,
    category: "impuestos",
  },
];

const router: IRouter = Router();

router.get("/emails", async (req, res): Promise<void> => {
  const query = ListEmailsQueryParams.safeParse(req.query);
  let emails = [...MOCK_EMAILS];

  if (query.success && query.data.limit) {
    emails = emails.slice(0, query.data.limit);
  }

  res.json(emails);
});

router.get("/emails/stats", async (_req, res): Promise<void> => {
  const total24h = MOCK_EMAILS.length;
  const unread = MOCK_EMAILS.filter((e) => !e.isRead).length;
  const important = MOCK_EMAILS.filter((e) => e.category === "impuestos" || e.category === "finanzas").length;
  res.json({ total24h, unread, important });
});

export default router;
