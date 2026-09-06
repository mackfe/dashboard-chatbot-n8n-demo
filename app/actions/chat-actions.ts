'use server';

import { fetchInstances } from "./instance-actions";

const evolutionUrl = process.env.EVOLUTION_API_URL;
const evolutionApiKey = process.env.EVOLUTION_API_KEY;

export type InboxMedia =
  | { kind: 'image'  ; mime?: string; fileName?: string | null; caption?: string | null; remoteJid: string; messageId: string }
  | { kind: 'video'  ; mime?: string; fileName?: string | null; caption?: string | null; remoteJid: string; messageId: string }
  | { kind: 'audio'  ; mime?: string; fileName?: string | null; remoteJid: string; messageId: string }
  | { kind: 'document'; mime?: string; fileName?: string | null; remoteJid: string; messageId: string }
  | { kind: 'sticker'; mime?: string; remoteJid: string; messageId: string };

export interface Message {
  id: string;
  text: string | null;
  sender: string;
  type: 'sent' | 'received';
  timestamp: number;
  media?: InboxMedia;
}

export interface Chat {
  id: string;          // <-- ahora será SIEMPRE el JID (ej: 5842...@s.whatsapp.net)
  name: string;
  lastMessage: string;
  avatar: string;
  instance: string;
  convId?: string;     // <-- opcional: id interno original (c.id)
}


const headers = { 
    'apikey': evolutionApiKey || '', 
    'Content-Type': 'application/json' 
};

const jidToName = (remoteJid: string, displayName?: string) =>
  displayName?.trim() || (remoteJid?.split('@')[0] ?? 'Unknown');

export async function fetchChats(instanceName: string): Promise<Chat[]> {
  if (!evolutionUrl || !evolutionApiKey) return [];

  try {
    const res = await fetch(`${evolutionUrl}/chat/findChats/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      headers,
      cache: 'no-store',
    });
    if (!res.ok) {
      console.error(`fetchChats failed for ${instanceName} with status: ${res.status}`);
      return [];
    }

    const data = await res.json();
    const list: any[] = Array.isArray(data) ? data
      : Array.isArray(data?.response) ? data.response
      : Array.isArray(data?.chats) ? data.chats
      : [];

    return list
      .map(c => {
        const convId = String(c?.id ?? ''); // id interno (puede ser cmeq7...)
        const jidCandidate = String(c?.remoteJid ?? c?.jid ?? '').trim(); // el bueno
        const id = jidCandidate || convId; // preferimos el JID; si no hay, caemos al interno

        return { c, id, convId };
      })
      // filtra usando el JID real si existe; si no existe, deja pasar pero no es ideal
      .filter(x => {
        const jid = x.id;
        if (!jid) return false;
        return !jid.endsWith('@g.us') && !jid.startsWith('status@') && !jid.includes('broadcast');
      })
      .map(({ c, id, convId }) => {
        const preview =
          c?.lastMessage?.text ||
          c?.lastMessage?.message?.conversation ||
          c?.lastMessage?.message?.extendedTextMessage?.text ||
          '[Mensaje]';

        const name = jidToName(id, c?.name || c?.pushName);

        return {
          id,                      // <-- JID
          convId,                  // <-- id interno por si lo necesitas
          name,
          lastMessage: preview,
          avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`,
          instance: instanceName,
        } as Chat;
      });
  } catch (error) {
    console.error(`Error in fetchChats for ${instanceName}:`, error);
    return [];
  }
}

export async function fetchMessages(instanceName: string, remoteJidOrNumber: string): Promise<Message[]> {
  if (!evolutionUrl || !evolutionApiKey) return [];

  const numberOnly = (remoteJidOrNumber.includes('@')
    ? remoteJidOrNumber.split('@')[0]
    : remoteJidOrNumber).replace(/[^\d+]/g, '').replace(/^\+/, '');
  const jid = remoteJidOrNumber.includes('@') ? remoteJidOrNumber : `${numberOnly}@s.whatsapp.net`;

  const extractList = (raw: any): any[] => {
    // v2 estable: { messages: { total, pages, currentPage, records: [...] } }
    if (raw?.messages?.records && Array.isArray(raw.messages.records)) return raw.messages.records;
    // otras variantes históricas
    if (Array.isArray(raw?.response)) return raw.response;
    if (Array.isArray(raw?.data)) return raw.data;
    if (Array.isArray(raw?.messages)) return raw.messages;
    if (Array.isArray(raw)) return raw;
    return [];
  };

  const pickText = (m: any): string | null => {
    const msg = m?.message || m;
    return (
      msg?.conversation ||
      msg?.extendedTextMessage?.text ||
      msg?.imageMessage?.caption ||
      msg?.videoMessage?.caption ||
      msg?.documentMessage?.caption ||
      m?.text || null
    );
  };

  // --- Pagina hasta agotar (pageSize = offset) ---
  const pageSize = 200; // ajusta si quieres menos/más por página
  const maxPages = 10;  // guardarraíl para no dispararnos si hubiera miles

  const all: any[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const body = {
      where: { key: { remoteJid: jid } },
      page,
      offset: pageSize,
    };

    const res = await fetch(
      `${evolutionUrl}/chat/findMessages/${encodeURIComponent(instanceName)}`,
      { method: 'POST', headers, cache: 'no-store', body: JSON.stringify(body) }
    );

    if (!res.ok) break;
    const raw = await res.json();
    const pageRecords = extractList(raw);

    // Si esta página viene vacía, detenemos
    if (!pageRecords.length) break;

    all.push(...pageRecords);

    // Si el backend nos dice cuántas páginas hay, podemos cortar antes
    const totalPages = raw?.messages?.pages;
    const currentPage = raw?.messages?.currentPage;
    if (typeof totalPages === 'number' && typeof currentPage === 'number' && currentPage >= totalPages) {
      break;
    }
  }

  // --- Mapea a tu tipo Message ---
  const out: Message[] = all
    .map((m: any) => {
      const key = m?.key || {};
      const fromMe = !!(key?.fromMe ?? m?.fromMe);
      const baseMsg = m?.message || {};
      const remoteJid = key?.remoteJid || m?.remoteJid || jid;

      // Detecta media
      let media: Message['media'] | undefined;
      if (baseMsg.imageMessage) {
        media = { kind: 'image',  mime: baseMsg.imageMessage.mimetype, fileName: baseMsg.imageMessage?.fileName ?? null, caption: baseMsg.imageMessage?.caption ?? null, remoteJid, messageId: key?.id || m?.id };
      } else if (baseMsg.videoMessage) {
        media = { kind: 'video',  mime: baseMsg.videoMessage.mimetype, fileName: baseMsg.videoMessage?.fileName ?? null, caption: baseMsg.videoMessage?.caption ?? null, remoteJid, messageId: key?.id || m?.id };
      } else if (baseMsg.audioMessage) {
        media = { kind: 'audio',  mime: baseMsg.audioMessage.mimetype, fileName: baseMsg.audioMessage?.fileName ?? null, remoteJid, messageId: key?.id || m?.id };
      } else if (baseMsg.documentMessage) {
        media = { kind: 'document', mime: baseMsg.documentMessage.mimetype, fileName: baseMsg.documentMessage?.fileName ?? null, remoteJid, messageId: key?.id || m?.id };
      } else if (baseMsg.stickerMessage) {
        media = { kind: 'sticker', mime: 'image/webp', remoteJid, messageId: key?.id || m?.id };
      }
      
      const ts =
        typeof m?.messageTimestamp === 'number' ? m.messageTimestamp :
        typeof m?.timestamp === 'number' ? m.timestamp :
        m?.messageTimestamp?.low ? Number(m.messageTimestamp.low) :
        Date.now();

      return {
        id: key?.id || m?.id,
        text: pickText(m),
        sender: fromMe ? 'You' : jidToName(key?.remoteJid || m?.remoteJid || jid, m?.pushName),
        type: fromMe ? 'sent' : 'received',
        timestamp: ts,
        media,
      } as Message;
    })
    .filter(x => !!x.id)
    .sort((a, b) => a.timestamp - b.timestamp);

  return out;
}


export async function sendMessageFromInbox(
    instanceName: string,
    recipient: string,
    message: string
) {
    if (!evolutionUrl || !evolutionApiKey) {
        return { success: false, message: 'API URL or Key is not configured.' };
    }
    // Robust number extraction
    const to = (recipient.includes('@') ? recipient.split('@')[0] : recipient)
        .replace(/\D/g, '');

    try {
        const res = await fetch(`${evolutionUrl}/message/sendText/${encodeURIComponent(instanceName)}`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              number: to,
              options: { delay: 1200, presence: 'composing' },
              textMessage: {
                text: message
              },
            }),
        });
        
        if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            // @ts-ignore
            const errorMessage = e?.response?.message || e?.message || 'Unknown error';
            return { success: false, message: `Failed to send message: ${errorMessage}` };
        }
        
        return { success: true, message: 'Message sent!' };
    } catch (error) {
        console.error('Error in sendMessageFromInbox:', error);
        return { success: false, message: 'An unexpected error occurred.' };
    }
}

export async function getInstancesForInbox() {
    return await fetchInstances();
}

export async function downloadMessageMedia(
  instanceName: string,
  payload: { remoteJid: string; messageId: string }
): Promise<{ url?: string; mime?: string; filename?: string; error?: string }> {
  if (!evolutionUrl || !evolutionApiKey) return { error: 'API URL/KEY no configurados' };

  const tries = [
    `${evolutionUrl}/message/downloadMedia/${encodeURIComponent(instanceName)}`,
    `${evolutionUrl}/message/download/${encodeURIComponent(instanceName)}`,
  ];

  for (const url of tries) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      if (!r.ok) continue;
      const data = await r.json();

      const b64 = data?.base64 || data?.file || data?.data;
      const mime = data?.mimetype || data?.mime || 'application/octet-stream';
      const filename = data?.filename || `${payload.messageId}`;

      if (b64) return { url: `data:${mime};base64,${b64}`, mime, filename };
    } catch {}
  }
  return { error: 'No se pudo descargar el archivo para este mensaje.' };
}

export async function fetchMessagesPage(
  instanceName: string,
  remoteJidOrNumber: string,
  page = 1,
  offset = 100
): Promise<{ records: Message[]; page: number; pages: number; total: number }> {
  if (!evolutionUrl || !evolutionApiKey) return { records: [], page, pages: 1, total: 0 };

  const numberOnly = (remoteJidOrNumber.includes('@')
    ? remoteJidOrNumber.split('@')[0]
    : remoteJidOrNumber).replace(/[^\d+]/g, '').replace(/^\+/, '');
  const jid = remoteJidOrNumber.includes('@') ? remoteJidOrNumber : `${numberOnly}@s.whatsapp.net`;

  const extractList = (raw: any): any[] =>
    raw?.messages?.records ?? raw?.response ?? raw?.data ?? raw?.messages ?? (Array.isArray(raw) ? raw : []) ?? [];

  const pickText = (m: any): string | null => {
    const msg = m?.message || m;
    return (
      msg?.conversation ||
      msg?.extendedTextMessage?.text ||
      msg?.imageMessage?.caption ||
      msg?.videoMessage?.caption ||
      msg?.documentMessage?.caption ||
      m?.text || null
    );
  };

  const body = { where: { key: { remoteJid: jid } }, page, offset };
  const res = await fetch(`${evolutionUrl}/chat/findMessages/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    headers,
    cache: 'no-store',
    body: JSON.stringify(body),
  });
  if (!res.ok) return { records: [], page, pages: 1, total: 0 };

  const raw = await res.json();
  const pages = Number(raw?.messages?.pages ?? 1) || 1;
  const total = Number(raw?.messages?.total ?? 0) || 0;

  const list = extractList(raw);
  const records: Message[] = list
    .map((m: any) => {
      const key = m?.key || {};
      const fromMe = !!(key?.fromMe ?? m?.fromMe);
      const baseMsg = m?.message || {};
      const remoteJid = key?.remoteJid || m?.remoteJid || jid;

      let media: Message['media'] | undefined;
      if (baseMsg.imageMessage) {
        media = { kind: 'image', mime: baseMsg.imageMessage.mimetype, fileName: baseMsg.imageMessage?.fileName ?? null, caption: baseMsg.imageMessage?.caption ?? null, remoteJid, messageId: key?.id || m?.id };
      } else if (baseMsg.videoMessage) {
        media = { kind: 'video', mime: baseMsg.videoMessage.mimetype, fileName: baseMsg.videoMessage?.fileName ?? null, caption: baseMsg.videoMessage?.caption ?? null, remoteJid, messageId: key?.id || m?.id };
      } else if (baseMsg.audioMessage) {
        media = { kind: 'audio', mime: baseMsg.audioMessage.mimetype, fileName: baseMsg.audioMessage?.fileName ?? null, remoteJid, messageId: key?.id || m?.id };
      } else if (baseMsg.documentMessage) {
        media = { kind: 'document', mime: baseMsg.documentMessage.mimetype, fileName: baseMsg.documentMessage?.fileName ?? null, remoteJid, messageId: key?.id || m?.id };
      } else if (baseMsg.stickerMessage) {
        media = { kind: 'sticker', mime: 'image/webp', remoteJid, messageId: key?.id || m?.id };
      }

      const ts =
        typeof m?.messageTimestamp === 'number' ? m.messageTimestamp :
        typeof m?.timestamp === 'number' ? m.timestamp :
        m?.messageTimestamp?.low ? Number(m.messageTimestamp.low) :
        Date.now();

      return {
        id: key?.id || m?.id,
        text: pickText(m),
        sender: fromMe ? 'You' : jidToName(remoteJid, m?.pushName),
        type: fromMe ? 'sent' : 'received',
        timestamp: ts,
        media,
      } as Message;
    })
    .filter(x => !!x.id)
    .sort((a, b) => a.timestamp - b.timestamp);

  return { records, page, pages, total };
}
