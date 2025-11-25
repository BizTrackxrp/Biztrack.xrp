// api/resend.js - Resend webhook handler for email events
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

module.exports = async (req, res) => {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const event = req.body;
    console.log('📧 Resend webhook received:', event.type);

    // Extract event data
    const { type, created_at, data } = event;

    // Handle different event types and log them
    let status = 'unknown';
    let extraInfo = null;

    switch (type) {
      case 'email.sent':
        console.log(`✅ Email sent to ${data.to}`);
        status = 'sent';
        break;
      case 'email.delivered':
        console.log(`📬 Email delivered to ${data.to}`);
        status = 'delivered';
        break;
      case 'email.delivery_delayed':
        console.log(`⏱️ Email delivery delayed to ${data.to}`);
        status = 'delayed';
        break;
      case 'email.complained':
        console.log(`🚨 Spam complaint from ${data.to}`);
        status = 'complained';
        break;
      case 'email.bounced':
        console.log(`❌ Email bounced to ${data.to}`);
        status = 'bounced';
        extraInfo = data.bounce?.type || 'unknown';
        break;
      case 'email.opened':
        console.log(`👀 Email opened by ${data.to}`);
        status = 'opened';
        break;
      case 'email.clicked':
        console.log(`🖱️ Link clicked in email by ${data.to}`);
        status = 'clicked';
        extraInfo = data.click?.link || null;
        break;
      default:
        console.log(`❓ Unknown event type: ${type}`);
    }

    // Log to email_logs table
    await pool.query(
      `INSERT INTO email_logs (
        event_type,
        event_time,
        email_id,
        recipient,
        sender,
        subject,
        status,
        extra_info,
        raw_event,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [
        type,
        new Date(created_at),
        data?.email_id || null,
        data?.to || null,
        data?.from || null,
        data?.subject || null,
        status,
        extraInfo,
        JSON.stringify(event)
      ]
    );

    // Handle critical events (bounces, complaints) - update user record
    if (type === 'email.bounced' || type === 'email.complained') {
      await pool.query(
        `UPDATE users SET 
          email_status = $1,
          email_status_updated = NOW()
        WHERE email = $2`,
        [status, data.to]
      );
      console.log(`⚠️ Updated user email status to ${status} for ${data.to}`);
    }

    // Return success
    return res.status(200).json({ 
      success: true, 
      message: 'Webhook processed',
      eventType: type 
    });

  } catch (error) {
    console.error('❌ Error processing Resend webhook:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
};
