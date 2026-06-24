// Server-Sent Events: the single broadcast channel to every connected browser.

const clients = new Set();

export function addClient(res) {
    clients.add(res);
}

export function removeClient(res) {
    clients.delete(res);
}

export function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(payload);
}
