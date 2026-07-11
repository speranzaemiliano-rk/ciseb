# CISEB — Marco de Producto

> Documento de encuadre. Traduce el *Relevamiento del Ecosistema Odontológico v1.0*
> (fuente de verdad del proyecto hasta el cierre de la Fase 0) al contexto del
> código que vive en este repositorio, y deja explícito **qué de la visión ya
> está construido y qué falta**. Idioma del proyecto: español (Argentina).
>
> Si hay conflicto entre este documento y el relevamiento original sobre la
> *visión*, manda el relevamiento. Sobre el *estado del código*, manda este.

---

## 1. Qué es CISEB (una frase)

Un ecosistema digital para centros odontológicos chicos y medianos (~10
profesionales), entregado **llave en mano**: cada centro es dueño de su instancia,
sus datos y su entorno, y paga un **abono de mantenimiento y cumplimiento**. El
diferencial no es funcional sino de **confianza**: se desarrolla y mantiene bajo
un SGSI (ISO 27001) y un SGIA (ISO 42001) del proveedor, y cada instalación
incluye un sistema de gestión plantilla para el centro, pre-mapeado a la
normativa argentina de datos de salud.

**Centro piloto:** el consultorio de la fundadora. Regla dura del MVP: **debe
operar ese centro de punta a punta con datos reales.**

## 2. Posicionamiento (las tres capas del cumplimiento)

Las ISO certifican **sistemas de gestión de organizaciones, no productos**. El
discurso comercial se apoya en tres capas y no debe confundirlas:

1. **Proveedor certificado** — la empresa se certifica en 27001/42001 con alcance
   sobre diseño, desarrollo, implementación y soporte del ecosistema. Mensaje
   mientras no haya auditoría: *"diseñado bajo 27001, en proceso de certificación"*.
2. **SGI plantilla incluido** — cada instalación entrega, además del software, la
   documentación de gestión del centro (políticas, matriz de riesgos, gestión de
   accesos, respaldo, registro de tratamiento de datos sensibles) pre-mapeada al
   Anexo A y a la Ley 25.326.
3. **Acompañamiento a certificación (opcional)** — servicio aparte para el centro
   que quiera certificarse. La certificación la emite siempre un tercero.

**Fuera de alcance por decisión explícita:** el circuito de **obras sociales**
(padrones, débitos, facturación por convenio). El producto apunta a atención
**privada/particular**. Se puede agregar a futuro, pero no condiciona el diseño.

## 3. Principio rector de arquitectura

**Una sola frontera, que además es política del SGSI:**

> **Lo clínico nunca vive en Workspace. Lo administrativo puede vivir en Workspace.**
> Ambos mundos comparten una sola identidad.

De esa frontera se desprende también qué IA toca qué: la IA administrativa
(Gemini de Workspace) nunca toca dato clínico; la IA clínica (asistente interno
por API, con context injection) hereda los permisos del usuario, es **solo
lectura** en el MVP y **registra toda consulta** (controles del SGIA).

## 4. Modelo de datos objetivo (tesis central)

El hallazgo que ordena todo el diseño: **nadie llena el odontograma porque es
trabajo duplicado.** La solución no es un odontograma más lindo, sino **eliminar
el doble registro: la evolución es el punto de entrada único.**

El profesional carga la evolución de forma estructurada (elige prestación del
catálogo, marca pieza y cara en FDI, agrega texto libre) y de ese **único gesto**
el sistema: (a) actualiza el odontograma, (b) genera el cobro del día, (c)
alimenta la liquidación. **Una carga, tres módulos.** La meta de UX: cargar una
evolución en **menos de 30 segundos** — si es más rápido que el papel, se usa.

Entidades objetivo (resumen del relevamiento §6):

| Entidad | Rol |
|---|---|
| **Paciente** | Núcleo. Incluye consentimiento de comunicaciones desde el día 1 (habilita CRM y cumple Ley 25.326). |
| **Profesional** | Usuario con rol (RBAC), especialidad y regla de reparto. |
| **Prestación (catálogo)** | Entidad central: nombre, especialidad, duración, precio de referencia, flag *requiere consentimiento*. Une agenda, clínica y finanzas. |
| **Turno** | Paciente + profesional + prestación + fecha/hora + estado. Sincroniza bidireccional con Google Calendar. |
| **Evolución** | **Punto de entrada único.** Turno + prestación + piezas/caras (FDI) + texto + firma. Dispara odontograma y cobro. Bloquea si falta consentimiento requerido. |
| **Odontograma** | FDI, por cara, tres capas (inicial / planificado / realizado). Se actualiza desde la evolución. Reserva estructura para periodontograma (post-MVP). |
| **Plan / Presupuesto** | Prestaciones por etapas con precios; documento enviable, aceptación/firma. Ortodoncia es el piloto natural. |
| **Esquema de pago** | Desacoplado de la visita: por sesión, cuota fija, adelantado o libre. Ficha muestra avance de tratamiento vs. avance de pago. |
| **Cobro y Liquidación** | Cada cobro se descompone en **participaciones** según la regla del profesional ejecutante hacia **beneficiarios** (en el piloto: cada socio + el fondo común). Liquidación por período configurable (diaria en el piloto). |
| **Documento / Imagen** | Radiografías, fotos, consentimientos: en Cloud Storage, cifrados, vinculados a paciente y evolución, con registro de origen. |
| **Lista de espera** | Estructura el criterio hoy tácito de la asistente: ante cancelación, el sistema sugiere candidatos, el humano decide. |

## 5. Arquitectura objetivo vs. stack actual

| Capa | Objetivo del relevamiento | Stack actual de este repo |
|---|---|---|
| Identidad | Google Workspace SSO + RBAC por rol | Firebase Auth (email/password + Google sign-in); roles `superadmin/admin/editor/lector` **aplicados solo en cliente** |
| Dato clínico | GCP **Firestore** (relacional, concurrencia, trazabilidad fina) | Firebase **Realtime Database** (mismo ecosistema Google, pero sin la trazabilidad fina de Firestore) |
| Imágenes | GCP Cloud Storage + **portal de carga por signed URLs** | Firebase Storage, subida **directa desde el modal** (sin portal de enlaces firmados) |
| Frontera clínico/admin | Separación física (clínico fuera de Workspace) | **Todo junto** en una misma base Realtime DB |
| Interfaz | App web propia con RBAC real | `index.html` único, JS vanilla sin build, hospedado en GitHub Pages |
| IA administrativa | Gemini de Workspace | — (no aplica al modo actual) |
| IA clínica | Asistente por API, solo lectura, con logging de cada consulta | Asistente Gemini con *context injection* de los datos de la app **sin** el scoping de permisos ni el logging clínico que exige el SGIA |
| Backend | Infra como código, un código base / N configuraciones | Backend Express en Railway (ARCA, Belvo/Prometeo, WhatsApp, mail bot); instancia única, no parametrizada por centro |

> **Nota:** Firebase *es* parte de GCP. La distancia real no es de proveedor sino
> de piezas: Realtime DB → Firestore, subida directa → portal de signed URLs,
> auth propia → Workspace SSO, roles cliente → RBAC efectivo.

## 6. Estado actual del código vs. objetivo (mapa honesto)

Leyenda: ✅ construido · 🟡 parcial · ⬜ no existe todavía.

| Capacidad del relevamiento | Estado | Nota |
|---|---|---|
| Ficha de **Paciente** | ✅ | Datos personales, obra social, notas/antecedentes, profesional asignado, estudios adjuntos. Falta el campo formal de *consentimiento de comunicaciones*. |
| **Profesionales** con especialidad/matrícula | ✅ | |
| **Reglas de reparto** por profesional | ✅ | `% general + override por tratamiento` hacia el profesional, y esa parte se reparte además entre **beneficiarios múltiples** (socios + fondo común) configurables por profesional. Retrocompatible: sin configurar nada, cae en un bucket "Sin asignar". |
| **Turnos** / agenda | 🟡 | Listado filtrable por fecha/estado, con `id` estable, FK a paciente/profesional/prestación, duración/hora de fin y detección de solapamiento de horario (aviso no bloqueante). **Confirmación automática 24h por mail lista** (backend revisa cada 30 min, manda recordatorio con link de confirmación de un solo uso). **Sync con Google Calendar de una sola vía** (app → Calendar, reusa el Client ID de Google ya usado para Gmail): falta la vía inversa (webhook/polling desde Calendar hacia la app). |
| **Catálogo de prestaciones** | ✅ | Entidad propia (`prestaciones`): nombre, especialidad, duración, precio de referencia, flag *requiere consentimiento*. Separado del módulo heredado "Tratamientos" (facturación por cliente, es otra cosa). |
| **Evolución estructurada** (entrada única) | ✅ | Implementada: profesional + prestación + piezas/caras + estado + texto → en un guardado actualiza odontograma y genera el cobro. Falta el vínculo a un Turno concreto y a Documento/Imagen. |
| **Odontograma** FDI, ambas denticiones, 5 superficies | ✅ | Numeración FDI completa (permanente + temporal), modo Adulto/Mixta, 5 caras + condición de pieza. **Las 3 capas del documento**: `inicial` (editable a mano), `planificado` (desde un Plan por etapas) y `realizado` (desde una Evolución) — conviven visualmente en la misma pieza. |
| **Plan de tratamiento / presupuesto por etapas** | ✅ | Prestaciones agrupadas por etapas con precio, vinculadas opcionalmente a piezas/caras del odontograma (activa la capa `planificado`). Documento imprimible, aceptación del paciente con firma en pantalla, y auto-completado de etapas cuando una Evolución coincide con lo planificado. |
| **Esquemas de pago** (sesión/cuota/adelantado/libre) | ✅ | Las 4 variantes del documento. Cobros imputables a un plan desde la Evolución, o vía **Registrar Pago** directo (desacoplado de la visita — ej. cobrar una cuota sin cargar una evolución clínica ese día). Ficha del paciente muestra cobrado/saldo/% de avance por plan. |
| **Cobro → liquidación** desde la evolución | ✅ | Cada cobro reparte `montoConsultorio` entre beneficiarios (`participaciones[]`, normalizado y redondeado sin diferencia de centavos). Reporte **Liquidación** por rango de fechas: totales por beneficiario y por profesional, con total general para reconciliar. Falta: corte configurable más allá del rango manual (diario/semanal/mensual automático) y exportación. |
| **Estudios/imágenes** vinculados a paciente | ✅ | PDFs/imágenes por paciente en Firebase Storage, ahora con **portal de carga externa por signed URLs** (radiólogo/laboratorio sube sin credenciales del sistema, link temporal generado desde la ficha). Falta el vínculo a la evolución y desplegar/revisar `storage.rules` (recién agregado al repo, no deployado). |
| **Consentimiento electrónico con evidencia** | ✅ | Firma en pantalla (canvas) + nombre del firmante + checkbox, con evidencia (texto exacto firmado, dispositivo, fecha). **Bloqueo real**: una evolución de una prestación que requiere consentimiento no se guarda sin uno vigente. Texto base configurable, con default marcado explícitamente como MODELO — falta la validación legal real con abogado antes de vender el feature. |
| **Lista de espera** estructurada | ✅ | Entidad propia (`listaEspera`): paciente, profesional/prestación preferidos (opcionales), disponibilidad, prioridad (Normal/Urgente), estado. Al cancelar un turno, el sistema sugiere candidatos compatibles (mismo profesional o sin preferencia) y permite agendarlos en un clic — el humano decide y confirma. |
| **Asistente clínico** (solo lectura + logging) | 🟡 | Hay asistente Gemini útil, pero **sin** el scoping por permisos ni el registro de consultas que pide el SGIA. |
| **Bot de WhatsApp** de turnos | 🟡 | Backend preparado; falta cuenta de Meta + credenciales + alcance cerrado documentado. |
| **RBAC efectivo / SSO Workspace** | ⬜ | Roles solo en cliente; las reglas de Firebase son la única defensa real. |
| **Infra como código** (instalador) | ⬜ | Instancia única, no replicable por script todavía. |

**Lectura de una línea:** CISEB ya cierra las **Fases 3 y 4 del roadmap**, la
**Fase 2 (Agenda)** salvo la vía inversa de Calendar, y el **portal de signed
URLs** de la Fase 1 — evolución estructurada → odontograma (3 capas) → cobro →
liquidación con beneficiarios múltiples → esquemas de pago → planes por etapas
con aceptación del paciente → consentimientos con evidencia → lista de espera
→ confirmación automática 24h → sync con Calendar → carga externa de estudios
— funcionando de punta a punta y probado en cada pieza. Lo que falta ya no es
"más módulos clínicos": es la **capa de infraestructura y cumplimiento** que
convierte esto en el ecosistema llave en mano del documento — RBAC/SSO real
con Google Workspace, los controles del SGIA para el asistente (Fase 5), y el
instalador infraestructura-como-código.

## 7. Roadmap del relevamiento (§8) y dónde estamos parados

| Fase | Contenido | Dónde estamos |
|---|---|---|
| **0 — Definición** | Modelo de datos clínico, pantalla de evolución, mapa de riesgos, diseño del paquete llave en mano, consulta legal de consentimientos | En curso (este documento es insumo) |
| **1 — Núcleo clínico** | Login+RBAC, ficha, historia clínica, **evolución→odontograma** (FDI, 3 capas, por cara), adjuntos y portal de signed URLs | 🟡 ficha, adjuntos, **evolución→odontograma** (2 de 3 capas) y **portal de signed URLs** ya cerrados; falta RBAC efectivo |
| **2 — Agenda** | Catálogo con duraciones, sync Calendar, confirmación 24 h, notas de preferencia, lista de espera | 🟡 turno vinculado a duración/prestación con detección de solapamiento, **lista de espera con sugerencia automática al cancelar**, **confirmación automática 24h por mail** y **sync app→Calendar** ya cerrados; falta la vía inversa (Calendar→app) y notas de preferencia estructuradas |
| **3 — Finanzas** | Cobros desde la evolución, motor de beneficiarios, liquidación configurable, esquemas de pago, reporte por profesional/beneficiario | ✅ **Fase 3 cerrada.** Cobros desde la evolución, motor de beneficiarios múltiples, reporte por profesional/beneficiario, y esquemas de pago (sesión/cuota/adelantado/libre) imputados a un plan liviano — todo probado de punta a punta. **Fin del MVP comercializable según la regla del documento.** |
| **4 — Planes y consentimientos** | Presupuestos por etapas, aceptación, consentimiento con firma+evidencia, bloqueo de evolución sin consentimiento | ✅ **Fase 4 cerrada.** Presupuestos por etapas con documento imprimible y aceptación firmada, consentimiento con firma+evidencia y bloqueo real de evolución sin consentimiento — todo probado de punta a punta, incluida la capa `planificado` del odontograma. |
| **5 — IA** | Asistente clínico interno (context injection, solo lectura, logging) y luego bot WhatsApp | 🟡 asistente sí, controles del SGIA no |

**Fin del MVP comercializable = fin de Fase 3.**

## 8. Decisiones de diseño ya tomadas (no rediscutir sin nueva evidencia)

Del relevamiento §7. Las más determinantes para el código:

- **Dato clínico fuera de Workspace, en GCP.**
- **Identidad única: SSO Workspace + RBAC por rol** (no por persona).
- **Frontera clínico/administrativo como política**, no como sugerencia.
- **Evolución estructurada como registro único** (elimina el doble trabajo).
- **Sin módulo de obras sociales** (segmento privado/particular).
- **Periodontograma: estructura sí, funcionalidad post-MVP.**
- **Sillones no modelados en el MVP.**
- **Motor de liquidación con beneficiarios múltiples desde el MVP** (el centro de
  dueño único es el caso trivial del mismo motor).
- **Consentimiento electrónico con evidencia en el MVP**; firma digital
  certificada a futuro (validar textos con abogado de salud antes de vender).
- **Bot clínico interno de solo lectura con logging total antes que WhatsApp.**
- **Infra como código para toda instalación** (un código base, N configuraciones).
- **Reglas de negocio configurables, estructura del dato fija.**

## 9. Marco de cumplimiento (normativa argentina)

- **Ley 26.529** (derechos del paciente): admite historia clínica informatizada
  garantizando integridad, autenticidad, inalterabilidad y recuperabilidad;
  conservación mínima **10 años**.
- **Ley 25.326** (datos personales): los datos de salud son **sensibles**; el
  consentimiento para comunicaciones de marketing es requisito, no detalle.
- **Ley 25.506** (firma digital): distingue firma digital certificada de firma
  electrónica; la electrónica es válida con carga de prueba sobre quien la invoca
  → de ahí el diseño con **rastro de evidencia fuerte** (quién, cuándo,
  dispositivo, versión del texto).

## 10. Advertencia de encuadre para quien trabaje el código

Este repo nació como adaptación de un sistema administrativo/contable (rubro
inmobiliario) hacia el rubro odontológico. Por eso convive mucha funcionalidad
**administrativa madura** (caja, bancos, ingresos/egresos, proveedores,
facturación ARCA, reportes) con módulos clínicos **incipientes**. Al planificar
trabajo nuevo:

1. No confundir "lo que la app ya hace" con "lo que el producto será". Usar la
   tabla del §6 como verdad del estado.
2. El próximo salto de valor **no** es pulir lo administrativo: es construir el
   **núcleo clínico** (evolución → odontograma → cobro → liquidación).
3. Toda decisión nueva o cambio sobre lo aquí registrado **se versiona**. Ese
   hábito, además de orden, es evidencia de gestión para el futuro SGSI.
