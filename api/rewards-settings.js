// api/rewards-settings.js - Get and update rewards settings for a business
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

module.exports = async (req, res) => {
  // Authenticate
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const businessId = decoded.userId;

  // GET - Retrieve current settings
  if (req.method === 'GET') {
    try {
      const result = await pool.query(
        `SELECT rewards_enabled, points_per_claim, rewards_program_name, business_name
         FROM users WHERE id = $1`,
        [businessId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Business not found' });
      }

      const settings = result.rows[0];

      return res.status(200).json({
        success: true,
        settings: {
          rewardsEnabled: settings.rewards_enabled || false,
          pointsPerClaim: settings.points_per_claim || 10,
          programName: settings.rewards_program_name || '',
          businessName: settings.business_name || ''
        }
      });

    } catch (error) {
      console.error('Get rewards settings error:', error);
      return res.status(500).json({ error: 'Failed to get settings' });
    }
  }

  // POST - Update settings
  if (req.method === 'POST') {
    try {
      const { rewardsEnabled, pointsPerClaim, programName, businessName } = req.body;

      // Validate points
      const points = parseInt(pointsPerClaim);
      if (isNaN(points) || points < 1 || points > 1000) {
        return res.status(400).json({ error: 'Points per claim must be between 1 and 1000' });
      }

      // Update settings
      const result = await pool.query(
        `UPDATE users SET
          rewards_enabled = $1,
          points_per_claim = $2,
          rewards_program_name = $3,
          business_name = $4
         WHERE id = $5
         RETURNING rewards_enabled, points_per_claim, rewards_program_name, business_name`,
        [
          rewardsEnabled === true,
          points,
          programName ? programName.trim().substring(0, 100) : null,
          businessName ? businessName.trim().substring(0, 255) : null,
          businessId
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Business not found' });
      }

      const updated = result.rows[0];

      return res.status(200).json({
        success: true,
        message: 'Rewards settings updated',
        settings: {
          rewardsEnabled: updated.rewards_enabled,
          pointsPerClaim: updated.points_per_claim,
          programName: updated.rewards_program_name,
          businessName: updated.business_name
        }
      });

    } catch (error) {
      console.error('Update rewards settings error:', error);
      return res.status(500).json({ error: 'Failed to update settings' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
