// stripe-config.js - Stripe Configuration for BizTrack
module.exports = {
  // Stripe configuration
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  
  // Product/Price IDs from your Stripe dashboard
  priceIds: {
    essential: process.env.STRIPE_ESSENTIAL_PRICE_ID, // Add to .env
    scale: process.env.STRIPE_SCALE_PRICE_ID,         // Add to .env
    enterprise: process.env.STRIPE_ENTERPRISE_PRICE_ID // Add to .env
  },

  // Tier configurations
  tiers: {
    free: {
      name: 'Free',
      qrLimit: 100,
      price: 0,
      priceId: null,
      features: [
        '100 QR codes per month',
        'Basic product tracking',
        'Blockchain verification',
        'Community support'
      ]
    },
    essential: {
      name: 'Essential',
      qrLimit: 5000,
      price: 49.99,
      priceId: process.env.STRIPE_ESSENTIAL_PRICE_ID,
      stripeName: 'Essential',
      features: [
        '5,000 QR codes per month',
        'Product authentication',
        'Supply chain tracking',
        'Customer verification pages',
        'Email support'
      ]
    },
    scale: {
      name: 'Scale',
      qrLimit: 25000,
      price: 149.99,
      priceId: process.env.STRIPE_SCALE_PRICE_ID,
      stripeName: 'Scale',
      features: [
        '25,000 QR codes per month',
        'All Essential features',
        'Priority support',
        'Advanced analytics',
        'Custom branding'
      ]
    },
    enterprise: {
      name: 'Enterprise',
      qrLimit: 100000,
      price: 399.99,
      priceId: process.env.STRIPE_ENTERPRISE_PRICE_ID,
      stripeName: 'Enterprise',
      features: [
        '100,000 QR codes per month',
        'All Scale features',
        'Dedicated account manager',
        'Custom integrations',
        'White-label options',
        'SLA guarantee'
      ]
    }
  },

  // Helper function to get tier by price ID
  getTierByPriceId(priceId) {
    for (const [key, tier] of Object.entries(this.tiers)) {
      if (tier.priceId === priceId) {
        return { tier: key, ...tier };
      }
    }
    return null;
  },

  // Helper function to get tier config
  getTierConfig(tierName) {
    return this.tiers[tierName] || this.tiers.free;
  },

  // Check if upgrade is needed
  needsUpgrade(currentTier, qrCodesUsed) {
    const tierConfig = this.getTierConfig(currentTier);
    return qrCodesUsed >= tierConfig.qrLimit;
  },

  // Get next tier suggestion
  getNextTier(currentTier) {
    const tierOrder = ['free', 'essential', 'scale', 'enterprise'];
    const currentIndex = tierOrder.indexOf(currentTier);
    if (currentIndex < tierOrder.length - 1) {
      return tierOrder[currentIndex + 1];
    }
    return null; // Already at highest tier
  }
};
