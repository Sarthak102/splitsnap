export type Item = { id: string; name: string; quantity: number; price_paise: number };

export type Member = {
  user_id: string;
  name: string;
  offline: boolean;
  paid_method: 'upi' | 'cash' | null;
  paid_at: string | null;
  confirmed_at: string | null;
};

export type ClaimRow = { item_id: string; user_id: string; units: number; shared: boolean };

export type Bill = {
  id: string;
  host_id: string;
  host_name: string;
  host_vpa: string;
  total_paise: number;
  split_mode: 'items' | 'equal';
  people_count: number;
  items: Item[];
  members: Member[];
  claims: ClaimRow[];
};
