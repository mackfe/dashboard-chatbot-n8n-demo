# Dashboard + Chatbot Multi-Agente con n8n y Genkit

Dashboard web y sistema de chatbot multi-agente que orquesta flujos de conversación con **n8n** y **Google Genkit**, conectado a WhatsApp para atención automatizada.

**Proyecto de José Rodríguez (mackfe) — Demo pública**

## Funcionalidades

- ✅ Panel de control (dashboard) para monitorear conversaciones y agentes.
- ✅ Integración de chatbots con **n8n** (flujos multi-agente).
- ✅ Uso de **Google Genkit** para orquestar modelos de IA.
- ✅ Webhooks de WhatsApp para recibir y responder mensajes.
- ✅ Gestión de instancias de agentes y auditoría de conversaciones.

## Arquitectura

```
WhatsApp → Webhook (app/api/wa/webhook) → n8n (flujos multi-agente)
                                              ↓
                                  Google Genkit (LLMs)
                                              ↓
                              Respuesta → WhatsApp / Dashboard
```

- **`app/ai/genkit.ts`** — Configuración del runtime de IA.
- **`app/ai/dev.ts`** — Utilidades de desarrollo para IA.
- **`app/actions/chat-actions.ts`** — Acciones de conversación.
- **`app/actions/instance-actions.ts`** — Gestión de instancias de agentes.
- **`app/api/wa/webhook/route.ts`** — Webhook de WhatsApp.

## Stack
Next.js · TypeScript · n8n · Google Genkit · WhatsApp API · Docker

---

*Nota: repositorio demo con una selección representativa del código. El proyecto completo es privado.*
