/**
 * Bonanza Labs — x402 Payment Integration
 * Pay-per-video via HTTP 402 protocol
 */

export interface PaymentProvider {
  name: string;
  createInvoice(amount: number, description: string): Promise<PaymentInvoice>;
  verifyPayment(invoiceId: string): Promise<PaymentStatus>;
  getBalance(): Promise<number>;
}

export interface PaymentInvoice {
  invoiceId: string;
  amount: number;
  currency: string;
  paymentUrl: string;
  expiresAt: number;
}

export interface PaymentStatus {
  paid: boolean;
  amount: number;
  currency: string;
  txHash?: string;
}

// ===== x402 Payment Provider =====

export class X402PaymentProvider implements PaymentProvider {
  name = 'x402';
  private baseUrl: string;
  private walletAddress: string;
  private network: string;

  constructor(baseUrl = 'http://localhost:4020', walletAddress = '', network = 'base') {
    this.baseUrl = baseUrl;
    this.walletAddress = walletAddress;
    this.network = network;
  }

  async createInvoice(amount: number, description: string): Promise<PaymentInvoice> {
    const response = await fetch(`${this.baseUrl}/v1/invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount,
        currency: 'USDC',
        network: this.network,
        description,
        recipient: this.walletAddress
      })
    });

    const data = await response.json() as { invoice_id: string; payment_url: string; expires_at: number };
    return {
      invoiceId: data.invoice_id,
      amount,
      currency: 'USDC',
      paymentUrl: data.payment_url,
      expiresAt: data.expires_at
    };
  }

  async verifyPayment(invoiceId: string): Promise<PaymentStatus> {
    const response = await fetch(`${this.baseUrl}/v1/invoice/${invoiceId}`);
    const data = await response.json() as { paid: boolean; amount: number; currency: string; tx_hash?: string };
    return {
      paid: data.paid,
      amount: data.amount,
      currency: data.currency,
      txHash: data.tx_hash
    };
  }

  async getBalance(): Promise<number> {
    const response = await fetch(`${this.baseUrl}/v1/balance/${this.walletAddress}`);
    const data = await response.json() as { balance: number };
    return data.balance;
  }
}

// ===== Pricing Tiers =====

export const VIDEO_PRICING = {
  standard: { price: 0.50, currency: 'USDC', maxDuration: 60 },    // $0.50 per video
  hd: { price: 1.00, currency: 'USDC', maxDuration: 120 },         // $1.00 per video
  avatar: { price: 2.50, currency: 'USDC', maxDuration: 180 },     // $2.50 with avatar
  premium: { price: 5.00, currency: 'USDC', maxDuration: 300 },    // $5.00 premium
} as const;

export type VideoTier = keyof typeof VIDEO_PRICING;

export function createPaymentProvider(walletAddress?: string): PaymentProvider {
  return new X402PaymentProvider('http://localhost:4020', walletAddress ?? '', 'base');
}