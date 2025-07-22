export type PaymentStatus = 
  | 'pending'
  | 'processing' 
  | 'requires_action'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface PaymentIntent {
  id: string;
  gateway: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  clientSecret?: string;
  qrCode?: string; // For Twint QR code
  expiresAt?: Date;
  metadata?: Record<string, any>;
}

export interface CreateIntentParams {
  amount: number;
  currency: string;
  paymentMethod?: {
    gateway: string;
    data?: any;
  };
  metadata?: Record<string, any>;
  description?: string;
  returnUrl?: string;
  cancelUrl?: string;
  customer?: {
    email?: string;
    phone?: string;
    name?: string;
  };
}

export interface Refund {
  id: string;
  paymentIntentId: string;
  amount: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed';
  reason?: string;
  metadata?: Record<string, any>;
}

export interface PaymentMethod {
  id: string;
  gateway: string;
  name: string;
  description: string;
  icon?: string;
  countries?: string[];
  minAmount?: number;
  maxAmount?: number;
  supportedCurrencies?: string[];
}

export interface PaymentGateway {
  createIntent(params: CreateIntentParams): Promise<PaymentIntent>;
  confirmIntent(intentId: string): Promise<PaymentIntent>;
  createRefund(params: {
    paymentIntentId: string;
    amount?: number;
    reason?: string;
    metadata?: Record<string, any>;
  }): Promise<Refund>;
  handleWebhook?(body: any, headers: Record<string, string>): Promise<{
    paymentIntentId: string;
    status: PaymentStatus;
    metadata?: Record<string, any>;
  }>;
}