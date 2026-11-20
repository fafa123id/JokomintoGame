import * as push from "../services/push.service.js";

export function key(req, res) {
  res.json({ publicKey: push.publicKey() });
}

export async function subscribe(req, res) {
  push.saveSubscription(req.user.id, req.validated.subscription);
  await push.sendToUser(req.user.id, {
    title: "Notifikasi aktif ✅",
    body: "Joko akan kabari kamu kalau dia lapar, kotor, atau kesepian.",
    tag: "joko-welcome",
    url: "/",
  });
  res.status(201).json({ ok: true });
}

export function unsubscribe(req, res) {
  push.removeSubscription(req.user.id, req.validated.endpoint);
  res.json({ ok: true });
}
