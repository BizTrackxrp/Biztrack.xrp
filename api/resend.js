import { connectToDatabase } from '../../js/db.js';

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const event = req.body;

    console.log('📧 Resend webhook received:', event.type);

    // Connect to database
    const db = await connectToDatabase();
    const emailLogsCollection = db.collection('email_logs');

    // Extract event data
    const {
      type,
      created_at,
      data
    } = event;

    // Prepare log entry
    const logEntry = {
      eventType: type,
      eventTime: new Date(created_at),
      emailId: data?.email_id || null,
      to: data?.to || null,
      from: data?.from || null,
      subject: data?.subject || null,
      timestamp: new Date(),
      rawEvent: event // Store full event for debugging
    };

    // Handle different event types
    switch (type) {
      case 'email.sent':
        console.log(`✅ Email sent to ${data.to}`);
        logEntry.status = 'sent';
        break;

      case 'email.delivered':
        console.log(`📬 Email delivered to ${data.to}`);
        logEntry.status = 'delivered';
        break;

      case 'email.delivery_delayed':
        console.log(`⏱️ Email delivery delayed to ${data.to}`);
        logEntry.status = 'delayed';
        break;

      case 'email.complained':
        console.log(`🚨 Spam complaint from ${data.to}`);
        logEntry.status = 'complained';
        // TODO: You might want to unsubscribe this user or flag them
        break;

      case 'email.bounced':
        console.log(`❌ Email bounced to ${data.to}`);
        logEntry.status = 'bounced';
        logEntry.bounceType = data.bounce?.type || 'unknown';
        // TODO: Handle hard bounces (invalid email) vs soft bounces (mailbox full)
        break;

      case 'email.opened':
        console.log(`👀 Email opened by ${data.to}`);
        logEntry.status = 'opened';
        break;

      case 'email.clicked':
        console.log(`🖱️ Link clicked in email by ${data.to}`);
        logEntry.status = 'clicked';
        logEntry.clickedLink = data.click?.link || null;
        break;

      default:
        console.log(`❓ Unknown event type: ${type}`);
        logEntry.status = 'unknown';
    }

    // Save to database
    await emailLogsCollection.insertOne(logEntry);

    // Handle critical events (bounces, complaints)
    if (type === 'email.bounced' || type === 'email.complained') {
      // Update user record to mark email as invalid/complained
      const usersCollection = db.collection('users');
      await usersCollection.updateOne(
        { email: data.to },
        { 
          $set: { 
            emailStatus: type === 'email.bounced' ? 'bounced' : 'complained',
            emailStatusUpdated: new Date()
          } 
        }
      );
    }

    // Return success
    res.status(200).json({ 
      success: true, 
      message: 'Webhook processed',
      eventType: type 
    });

  } catch (error) {
    console.error('❌ Error processing Resend webhook:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}
