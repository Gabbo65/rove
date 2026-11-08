// Captures the active tab (the main process hands getDisplayMedia() the tab) and sends it to each phone
// as a WebRTC video track.
const peers = new Map(); // clientId -> { pc, sender }
let stream = null, streamSource = null, pending = null;

async function capture(sourceId) {
  if (stream && streamSource === sourceId) return stream;
  if (pending?.id === sourceId) return pending.promise;
  const promise = navigator.mediaDevices.getDisplayMedia({
    audio: false,
    video: { width: { max: 1600 }, height: { max: 1600 }, frameRate: { ideal: 30, max: 30 } },
  }).then((s) => {
    const old = stream;
    stream = s; streamSource = sourceId; pending = null;
    const track = s.getVideoTracks()[0];
    track.contentHint = 'detail'; // keep text sharp rather than smooth motion
    if (old) setTimeout(() => old.getTracks().forEach((t) => t.stop()), 500);
    return s;
  }, (err) => { pending = null; throw err; });
  pending = { id: sourceId, promise };
  return promise;
}

function stopIfIdle() {
  if (peers.size || !stream) return;
  stream.getTracks().forEach((t) => t.stop());
  stream = null; streamSource = null;
}

// Called by the main process (with a user gesture, which capturing requires).
window.pbOpen = async ({ clientId, sourceId }) => {
  try {
    const s = await capture(sourceId);
    const pc = new RTCPeerConnection({ iceServers: [] }); // same Wi-Fi: direct connection, no outside servers
    const sender = pc.addTrack(s.getVideoTracks()[0], s);
    peers.set(clientId, { pc, sender });
    const params = sender.getParameters();
    params.degradationPreference = 'maintain-resolution';
    params.encodings = [{ ...(params.encodings?.[0] || {}), maxBitrate: 6_000_000, maxFramerate: 30 }];
    sender.setParameters(params).catch(() => {});
    pc.onicecandidate = (e) => { if (e.candidate) window.streamer.signal(clientId, { kind: 'ice', candidate: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') window.streamer.signal(clientId, { kind: 'error', reason: 'ice-failed' });
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    window.streamer.signal(clientId, { kind: 'offer', sdp: pc.localDescription.sdp });
  } catch (err) {
    window.streamer.signal(clientId, { kind: 'error', reason: String(err?.message || err) });
  }
};

window.streamer.on('streamer:signal', async ({ clientId, msg }) => {
  const peer = peers.get(clientId);
  if (!peer) return;
  try {
    if (msg.kind === 'answer') await peer.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
    else if (msg.kind === 'ice' && msg.candidate) await peer.pc.addIceCandidate(msg.candidate);
  } catch (err) {
    window.streamer.signal(clientId, { kind: 'error', reason: String(err?.message || err) });
  }
});

// Tab switched: same video connections, new picture.
window.pbSource = async (sourceId) => {
  try {
    const s = await capture(sourceId);
    const track = s.getVideoTracks()[0];
    for (const { sender } of peers.values()) await sender.replaceTrack(track);
  } catch {}
};

window.streamer.on('streamer:close', (clientId) => {
  const peer = peers.get(clientId);
  if (peer) { peer.pc.close(); peers.delete(clientId); }
  stopIfIdle();
});
