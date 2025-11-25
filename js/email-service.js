import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

// Your company email
const ADMIN_EMAIL = 'info@biztrack.io';
const FROM_EMAIL = 'BizTrack <noreply@biztrack.io>';

/**
 * Send password change confirmation to customer
 */
export async function sendPasswordChangeEmail(userEmail, userName) {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: userEmail,
      subject: 'Password Changed Successfully',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #4F46E5, #7C3AED); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: white; padding: 30px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 10px 10px; }
            .alert { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px; }
            .footer { text-align: center; margin-top: 30px; color: #64748b; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔒 Password Changed</h1>
            </div>
            <div class="content">
              <p>Hi ${userName || 'there'},</p>
              <p>Your BizTrack password was successfully changed.</p>
              <div class="alert">
                <strong>⚠️ Didn't make this change?</strong><br>
                If you didn't request this password change, please contact us immediately at ${ADMIN_EMAIL}
              </div>
              <p>For security reasons, we recommend:</p>
              <ul>
                <li>Using a unique password for BizTrack</li>
                <li>Enabling two-factor authentication</li>
                <li>Never sharing your password</li>
              </ul>
              <p>Thanks,<br><strong>The BizTrack Team</strong></p>
            </div>
            <div class="footer">
              <p>© 2025 BizTrack - Powered by XRPL</p>
            </div>
          </div>
        </body>
        </html>
      `
    });

    if (error) {
      console.error('Error sending password change email:', error);
      return { success: false, error };
    }

    return { success: true, data };
  } catch (error) {
    console.error('Error sending password change email:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send new IP login alert to customer
 */
export async function sendNewIPLoginEmail(userEmail, userName, ipAddress, location) {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: userEmail,
      subject: 'New Login from Unrecognized Location',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #ef4444, #dc2626); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: white; padding: 30px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 10px 10px; }
            .info-box { background: #f8fafc; border: 1px solid #e2e8f0; padding: 20px; margin: 20px 0; border-radius: 8px; }
            .info-row { display: flex; justify-content: space-between; margin: 10px 0; }
            .info-label { font-weight: 600; color: #64748b; }
            .info-value { color: #1e293b; }
            .alert { background: #fee2e2; border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0; border-radius: 4px; }
            .footer { text-align: center; margin-top: 30px; color: #64748b; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🚨 New Login Detected</h1>
            </div>
            <div class="content">
              <p>Hi ${userName || 'there'},</p>
              <p>We detected a login to your BizTrack account from a new location.</p>
              
              <div class="info-box">
                <div class="info-row">
                  <span class="info-label">IP Address:</span>
                  <span class="info-value">${ipAddress}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Location:</span>
                  <span class="info-value">${location || 'Unknown'}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Time:</span>
                  <span class="info-value">${new Date().toLocaleString()}</span>
                </div>
              </div>

              <div class="alert">
                <strong>⚠️ Was this you?</strong><br>
                If you didn't make this login, please change your password immediately and contact us at ${ADMIN_EMAIL}
              </div>

              <p>For your security:</p>
              <ul>
                <li>Always log out from shared devices</li>
                <li>Use a strong, unique password</li>
                <li>Enable two-factor authentication</li>
              </ul>

              <p>Thanks,<br><strong>The BizTrack Team</strong></p>
            </div>
            <div class="footer">
              <p>© 2025 BizTrack - Powered by XRPL</p>
            </div>
          </div>
        </body>
        </html>
      `
    });

    if (error) {
      console.error('Error sending new IP login email:', error);
      return { success: false, error };
    }

    return { success: true, data };
  } catch (error) {
    console.error('Error sending new IP login email:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send password reset email to customer
 */
export async function sendPasswordResetEmail(userEmail, userName, resetLink) {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: userEmail,
      subject: 'Reset Your BizTrack Password',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #4F46E5, #7C3AED); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: white; padding: 30px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 10px 10px; }
            .button { display: inline-block; background: linear-gradient(135deg, #4F46E5, #7C3AED); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 20px 0; }
            .alert { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px; font-size: 14px; }
            .footer { text-align: center; margin-top: 30px; color: #64748b; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔑 Reset Your Password</h1>
            </div>
            <div class="content">
              <p>Hi ${userName || 'there'},</p>
              <p>We received a request to reset your BizTrack password. Click the button below to create a new password:</p>
              
              <div style="text-align: center;">
                <a href="${resetLink}" class="button">Reset Password</a>
              </div>

              <div class="alert">
                <strong>⏱️ This link expires in 1 hour</strong><br>
                For security reasons, password reset links are only valid for 60 minutes.
              </div>

              <p>If you didn't request this password reset, you can safely ignore this email. Your password will remain unchanged.</p>

              <p style="margin-top: 30px; font-size: 14px; color: #64748b;">
                If the button doesn't work, copy and paste this link into your browser:<br>
                <span style="word-break: break-all;">${resetLink}</span>
              </p>

              <p>Thanks,<br><strong>The BizTrack Team</strong></p>
            </div>
            <div class="footer">
              <p>© 2025 BizTrack - Powered by XRPL</p>
            </div>
          </div>
        </body>
        </html>
      `
    });

    if (error) {
      console.error('Error sending password reset email:', error);
      return { success: false, error };
    }

    return { success: true, data };
  } catch (error) {
    console.error('Error sending password reset email:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send admin notification when user downgrades
 */
export async function sendDowngradeNotification(userId, userEmail, userName, oldPlan, newPlan) {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `⚠️ User Downgrade: ${userEmail}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #f59e0b, #d97706); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: white; padding: 30px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 10px 10px; }
            .info-box { background: #fef3c7; border: 2px solid #f59e0b; padding: 20px; margin: 20px 0; border-radius: 8px; }
            .info-row { margin: 10px 0; }
            .info-label { font-weight: 600; color: #92400e; display: inline-block; width: 120px; }
            .info-value { color: #1e293b; font-family: monospace; }
            .action { background: #f8fafc; padding: 20px; margin: 20px 0; border-radius: 8px; border: 1px solid #e2e8f0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>⚠️ User Downgrade Alert</h1>
            </div>
            <div class="content">
              <p><strong>A user has downgraded their subscription.</strong></p>
              
              <div class="info-box">
                <div class="info-row">
                  <span class="info-label">User ID:</span>
                  <span class="info-value">${userId}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Email:</span>
                  <span class="info-value">${userEmail}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Name:</span>
                  <span class="info-value">${userName || 'Not provided'}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Old Plan:</span>
                  <span class="info-value">${oldPlan}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">New Plan:</span>
                  <span class="info-value">${newPlan}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Time:</span>
                  <span class="info-value">${new Date().toLocaleString()}</span>
                </div>
              </div>

              <div class="action">
                <p><strong>🔧 Action Required:</strong></p>
                <ol>
                  <li>Log into Stripe dashboard</li>
                  <li>Find customer: <code>${userEmail}</code></li>
                  <li>Update subscription to: <strong>${newPlan}</strong></li>
                </ol>
              </div>

              <p style="margin-top: 30px; color: #64748b; font-size: 14px;">
                This is an automated notification from BizTrack.
              </p>
            </div>
          </div>
        </body>
        </html>
      `
    });

    if (error) {
      console.error('Error sending downgrade notification:', error);
      return { success: false, error };
    }

    return { success: true, data };
  } catch (error) {
    console.error('Error sending downgrade notification:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send admin notification when user cancels
 */
export async function sendCancellationNotification(userId, userEmail, userName, plan) {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `🚨 User Cancellation: ${userEmail}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #ef4444, #dc2626); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: white; padding: 30px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 10px 10px; }
            .info-box { background: #fee2e2; border: 2px solid #ef4444; padding: 20px; margin: 20px 0; border-radius: 8px; }
            .info-row { margin: 10px 0; }
            .info-label { font-weight: 600; color: #991b1b; display: inline-block; width: 120px; }
            .info-value { color: #1e293b; font-family: monospace; }
            .action { background: #f8fafc; padding: 20px; margin: 20px 0; border-radius: 8px; border: 1px solid #e2e8f0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🚨 User Cancellation Alert</h1>
            </div>
            <div class="content">
              <p><strong>A user has cancelled their subscription.</strong></p>
              
              <div class="info-box">
                <div class="info-row">
                  <span class="info-label">User ID:</span>
                  <span class="info-value">${userId}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Email:</span>
                  <span class="info-value">${userEmail}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Name:</span>
                  <span class="info-value">${userName || 'Not provided'}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Plan:</span>
                  <span class="info-value">${plan}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Time:</span>
                  <span class="info-value">${new Date().toLocaleString()}</span>
                </div>
              </div>

              <div class="action">
                <p><strong>🔧 Action Required:</strong></p>
                <ol>
                  <li>Log into Stripe dashboard</li>
                  <li>Find customer: <code>${userEmail}</code></li>
                  <li>Cancel their subscription</li>
                  <li>Consider reaching out for feedback</li>
                </ol>
              </div>

              <p style="margin-top: 30px; color: #64748b; font-size: 14px;">
                This is an automated notification from BizTrack.
              </p>
            </div>
          </div>
        </body>
        </html>
      `
    });

    if (error) {
      console.error('Error sending cancellation notification:', error);
      return { success: false, error };
    }

    return { success: true, data };
  } catch (error) {
    console.error('Error sending cancellation notification:', error);
    return { success: false, error: error.message };
  }
}
