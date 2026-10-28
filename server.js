"use strict";

const express = require("express");
const cors = require("cors");
const ntpClient = require("ntp-client");

const app = express();
app.use(cors({
 origin: process.env.ALLOWED_ORIGIN || "*"
}));

const servers = [
 "bsti1.time.gov.bd",
 "bsti2.time.gov.bd",
 "time-a-g.nist.gov"
];

function query(server) {
 return new Promise((resolve, reject) => {
 ntpClient.getNetworkTime(server, 123, (error, date) => {
 if (error) reject(error);
 else resolve(date.getTime());
 });
 });
}

app.get("/time", async (_req, res) => {
 for (const server of servers) {
 try {
 const unixMs = await query(server);
 return res.json({
 unixMs,
 source: `${server} via server-side NTP`,
 protocol: "NTP/UDP"
 });
 } catch {
 // Try the next configured source.
 }
 }

 res.status(503).json({ error: "No configured time source responded." });
});

app.listen(process.env.PORT || 8787);
