const MESSAGES: Record<string, string> = {
  locked: "Someone has already paid, so this bill can't change now.",
  waiting_for_people: "Not everyone has joined yet, so the bill isn't final.",
  too_few_people: "That's fewer than the people already on the bill. Remove someone first.",
  seat_unavailable: 'That name was just taken, or it has already paid.',
  already_joined: "You're already on this bill.",
  bad_host_key: "That host link isn't valid. Open the bill from your original phone.",
  none_left: 'Someone just claimed the last one.',
  name_taken: 'Someone here already has that name. Add an initial.',
  equal_mode: 'This bill is being split equally now.',
  unclaimed_items: 'Every item has to be claimed before anyone pays.',
  nothing_claimed: "You haven't claimed anything yet.",
  bill_full: 'Everyone has already joined. Ask the host to add one more person.',
};

// Database functions raise short codes, which never reach the screen as they are.
export const friendlyError = (code: string) => MESSAGES[code] ?? "That didn't work. Check your connection and try again.";
