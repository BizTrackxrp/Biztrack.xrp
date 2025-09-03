export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const xummKey = process.env.XUMM_API_KEY;
  const xummSecret = process.env.XUMM_API_SECRET;

  // Minimal SignIn payload for Xaman
  const payload = { transactionType: 'SignIn' };

  try {
    const response = await fetch('https://xumm.app/api/v1/platform/payload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': xummKey,
        'X-API-Secret': xummSecret,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    // Provide the deep link and QR link to the client
    return res.status(200).json({ deepLink: data.next.always, qr: data.next.qr });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
