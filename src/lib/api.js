import { supabase } from './supabase.js';

// Köprüdeki veri uçları (/history, /report) oturum ister. Her istekte güncel
// erişim jetonu okunur — getSession süresi dolmuşsa jetonu kendisi yeniler,
// böylece uzun açık kalan sekmelerde istekler 401 almaz.
export async function bridgeFetch(url, options = {}) {
  const { data } = (await supabase?.auth.getSession()) ?? { data: {} };
  const token = data?.session?.access_token;

  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}
