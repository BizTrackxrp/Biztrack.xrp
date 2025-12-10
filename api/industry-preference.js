// api/industry-preference.js - Get and update user's industry preference
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

module.exports = async (req, res) => {
  // GET - retrieve current preference
  // POST - update preference
  
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed' 
    });
  }

  try {
    // Get auth token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false,
        error: 'Unauthorized - No token provided' 
      });
    }

    const token = authHeader.split(' ')[1];
    
    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (error) {
      return res.status(401).json({ 
        success: false,
        error: 'Invalid or expired token' 
      });
    }

    if (req.method === 'GET') {
      // Get current industry preference
      const result = await pool.query(
        `SELECT industry_preference FROM users WHERE id = $1`,
        [decoded.userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ 
          success: false,
          error: 'User not found' 
        });
      }

      return res.status(200).json({
        success: true,
        industryPreference: result.rows[0].industry_preference || 'general'
      });
    }

    if (req.method === 'POST') {
      const { industryPreference } = req.body;
      
      // Validate the preference value
      const validPreferences = ['general', 'food'];
      if (!validPreferences.includes(industryPreference)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid industry preference. Must be one of: ' + validPreferences.join(', ')
        });
      }

      // Update the preference
      const result = await pool.query(
        `UPDATE users SET industry_preference = $1 WHERE id = $2 RETURNING industry_preference`,
        [industryPreference, decoded.userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ 
          success: false,
          error: 'User not found' 
        });
      }

      return res.status(200).json({
        success: true,
        industryPreference: result.rows[0].industry_preference,
        message: 'Industry preference updated successfully'
      });
    }

  } catch (error) {
    console.error('Industry preference error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to process industry preference',
      details: error.message
    });
  }
};
