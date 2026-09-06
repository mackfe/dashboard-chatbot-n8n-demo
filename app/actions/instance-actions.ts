
'use server';

import { revalidatePath } from 'next/cache';

const evolutionUrl = process.env.EVOLUTION_API_URL;
const evolutionApiKey = process.env.EVOLUTION_API_KEY;

type UiStatus = 'connected' | 'disconnected' | 'pairing';

export interface Instance {
  name: string;
  status: UiStatus;
}

function mapStatus(s: string | undefined): UiStatus {
  const v = (s || '').toLowerCase();
  if (['open', 'connected', 'online'].includes(v)) return 'connected';
  if (['connecting', 'created', 'qrcode', 'pairing'].includes(v)) return 'pairing';
  return 'disconnected';
}

export async function getConnectionState(instanceName: string): Promise<UiStatus> {
  if (!evolutionUrl || !evolutionApiKey) return 'disconnected';
  try {
    const r = await fetch(
      `${evolutionUrl}/instance/connectionState/${encodeURIComponent(instanceName)}`,
      { headers: { apikey: evolutionApiKey }, cache: 'no-store' }
    );
    if (!r.ok) return 'disconnected';
    const data = await r.json();
    return mapStatus(data?.instance?.state);
  } catch (error) {
    console.error(`Error fetching connection state for ${instanceName}:`, error);
    return 'disconnected';
  }
}

export async function fetchInstances(): Promise<Instance[]> {
  if (!evolutionUrl || !evolutionApiKey) {
    console.error('API URL or Key is not configured.');
    return [];
  }
  
  const url = `${evolutionUrl}/instance/fetchInstances`;
  
  try {
    const response = await fetch(url, {
      headers: { 'apikey': evolutionApiKey },
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to fetch instances. Status: ${response.status}, Body: ${errorText}`);
      return [];
    }

    const raw = await response.json();
    
    const list: any[] = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.response)
        ? raw.response
        : Array.isArray(raw?.instances)
          ? raw.instances
          : [];

    if (list.length === 0) {
      // This is important: log what we received if the list is empty.
      console.log("Received empty instance list or unrecognized format. Raw response:", JSON.stringify(raw, null, 2));
      return [];
    }

    const baseInstances = list
      .map((item: any) => {
        const inst = item?.instance ?? item;
        return {
          name: inst?.instanceName ?? inst?.name,
          status: mapStatus(inst?.status ?? inst?.state),
        } as Instance;
      })
      .filter(x => !!x.name);

    // Refresca estado con connectionState (en paralelo)
    const states = await Promise.all(
      baseInstances.map(i => getConnectionState(i.name).catch(() => i.status))
    );

    return baseInstances.map((instance, idx) => ({
      ...instance,
      status: states[idx] ?? instance.status,
    }));

  } catch (error) {
    console.error('Error during fetchInstances execution:', error);
    return [];
  }
}

export async function createInstance(formData: FormData) {
  const instanceName = formData.get('instanceName') as string;

  if (!evolutionUrl || !evolutionApiKey) {
    return { success: false, message: 'API URL or Key is not configured.' };
  }
  
  const instanceConfig = {
    instanceName,
    qrcode: true,
    integration: "WHATSAPP-BAILEYS",
  };

  try {
    const response = await fetch(`${evolutionUrl}/instance/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': evolutionApiKey,
      },
      body: JSON.stringify(instanceConfig),
    });
    
    if (response.status === 403) {
        return { success: false, message: 'Failed to create instance: Forbidden. Please check your API Key and server logs.' };
    }

    if (!response.ok) {
       const errorData = await response.json();
       let errorMessage = "Bad Request";
        if (errorData?.response?.message) {
           errorMessage = Array.isArray(errorData.response.message) ? errorData.response.message.join(', ') : errorData.response.message;
       } else if (errorData?.message) {
           errorMessage = errorData.message;
       }
       console.error("Evolution API Error on create:", errorData);
       return { success: false, message: `Failed to create instance: ${errorMessage}` };
    }
    
    revalidatePath('/');
    return { success: true, message: 'Instance created successfully. You can now connect it.' };

  } catch (error) {
    console.error('Error creating instance:', error);
    return { success: false, message: 'An unexpected error occurred.' };
  }
}

export async function getQRCode(instanceName: string, phoneE164?: string): Promise<
  { pairingCode?: string; code?: string; error?: string }
> {
  if (!evolutionUrl || !evolutionApiKey) return { error: 'API URL or Key is not configured.' };

  const url = new URL(`${evolutionUrl}/instance/connect/${encodeURIComponent(instanceName)}`);
  if (phoneE164) url.searchParams.set('number', phoneE164);

  try {
    const r = await fetch(url.toString(), { headers: { apikey: evolutionApiKey }, cache: 'no-store' });
    if (r.status === 403) return { error: 'Forbidden. Please check your API Key.' };

    const d = await r.json();
    if (d?.pairingCode || d?.code) return { pairingCode: d.pairingCode, code: d.code };

    if (d?.base64) return { code: `data:image/png;base64,${d.base64}` };

    if (d?.instance?.status === 'open') {
        revalidatePath('/');
        return { error: 'Instance is already connected.' };
    }
    
    const errorMessage = d?.error || d?.message || 'Could not retrieve QR code.';
    console.error(`Error getting QR for ${instanceName}:`, d);
    return { error: errorMessage };

  } catch (error) {
    console.error(`Error getting QR code for ${instanceName}:`, error);
    return { error: 'An unexpected error occurred while fetching the QR code.' };
  }
}


export async function disconnectInstance(instanceName: string) {
  if (!evolutionUrl || !evolutionApiKey) {
    return { success: false, message: 'API URL or Key is not configured.' };
  }

  try {
    const response = await fetch(`${evolutionUrl}/instance/logout/${instanceName}`, {
      method: 'DELETE',
      headers: { 'apikey': evolutionApiKey },
    });
    
    if (response.status === 403) {
        return { success: false, message: 'Failed to disconnect: Forbidden. Check API Key.' };
    }

    if (!response.ok) {
      const errorData = await response.json();
      return { success: false, message: `Failed to disconnect: ${errorData.message || 'Unknown error'}` };
    }

    revalidatePath('/');
    return { success: true, message: 'Instance disconnected successfully.' };
  } catch (error) {
    console.error(`Error disconnecting instance ${instanceName}:`, error);
    return { success: false, message: 'An unexpected error occurred.' };
  }
}
