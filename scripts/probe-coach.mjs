import { io } from "socket.io-client";

const s = io("https://optcgwebsim.com", {
  transports: ["websocket", "polling"],
  withCredentials: false
});

const t0 = Date.now();
const done = (tag) => { console.log(`\n[${tag}] ${Date.now() - t0}ms`); s.close(); process.exit(0); };

s.on("connect", () => {
  console.log("connected", s.id);
  s.emit("msg", { t: "coachReview", seat: null, preview: true });
  setTimeout(() => s.emit("msg", { t: "coachHint", seq: 1, auto: false, plan: null }), 1500);
});

s.on("msg", (m) => {
  console.log(JSON.stringify(m, null, 2));
  if (m.t === "membershipRequired") done("gate");
  if (m.t === "coachReview" && !(m.result && m.result.preview)) done("review");
});

s.onAny((ev, ...args) => { if (ev !== "msg") console.log("event:", ev, JSON.stringify(args).slice(0, 500)); });
s.on("connect_error", (e) => done("connect_error: " + e.message));
s.on("disconnect", (r) => console.log("disconnect:", r));
setTimeout(() => done("timeout"), 20000);
