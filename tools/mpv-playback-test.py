"""Real-time playback probe for the app's own libmpv (the DLL Mangayomi ships), driven from Python ctypes.

Why: ffprobe and the Node harness accept things the app cannot play. This opens a URL the way media_kit does
(URL written to a temp file, `loadlist ... append`, idle=yes) and reports load time, tracks, real-time frame
counts, A/V sync, cache and seek results.

    python tools/mpv-playback-test.py <url-or-file-containing-it> <seconds> [seek,seek,...] [mpv-option=value ...]

Environment switches:  LOADLIST=append|replace  open via temp-file loadlist (default: plain loadfile)
                       UA_IN_HEADERS=1          put the User-Agent inside http-header-fields, like the app
                       VERBOSE=1                print mpv's info-level log lines about opening/playlists
Extra mpv options are k=v args, e.g. the app's own:
    idle=yes network-timeout=5 cache=yes cache-on-disk=yes demuxer-max-bytes=33554432 demuxer-max-back-bytes=33554432
    "demuxer-lavf-o=seg_max_retry=5,strict=experimental,allowed_extensions=ALL,protocol_whitelist=[udp,rtp,tcp,tls,data,file,http,https,crypto]"

Lessons that cost hours: idle=no makes mpv quit while a loadlist file is still being parsed (silent SHUTDOWN and
"not loaded"), so use idle=yes for the media_kit path. Counting real frames needs vo=image + vo-image-outdir (then
compare the files' write times to find stalls), because estimated-frame-number just follows the container fps
hint. Headers are comma-split by mpv; keep values comma-free. Do not run several at once when timing matters.
"""
import sys, time, os, ctypes
from ctypes import c_char_p, c_void_p, c_int, c_uint64, c_double, POINTER, Structure, byref, cast

DLL = r"C:\Users\malik\AppData\Local\Programs\Mangayomi\libmpv-2.dll"
os.add_dll_directory(os.path.dirname(DLL))
m = ctypes.CDLL(DLL)

class Ev(Structure):
    _fields_ = [("event_id", c_int), ("error", c_int), ("reply_userdata", c_uint64), ("data", c_void_p)]
class LogMsg(Structure):
    _fields_ = [("prefix", c_char_p), ("level", c_char_p), ("text", c_char_p), ("log_level", c_int)]
class EndFile(Structure):
    _fields_ = [("reason", c_int), ("error", c_int), ("playlist_entry_id", c_int64 if False else ctypes.c_int64), ("playlist_insert_id", ctypes.c_int64), ("playlist_insert_num_entries", c_int)]

m.mpv_create.restype = c_void_p
m.mpv_wait_event.restype = POINTER(Ev); m.mpv_wait_event.argtypes = [c_void_p, c_double]
m.mpv_set_option_string.argtypes = [c_void_p, c_char_p, c_char_p]
m.mpv_initialize.argtypes = [c_void_p]
m.mpv_command.argtypes = [c_void_p, POINTER(c_char_p)]
m.mpv_get_property_string.restype = c_void_p; m.mpv_get_property_string.argtypes = [c_void_p, c_char_p]
m.mpv_request_log_messages.argtypes = [c_void_p, c_char_p]
m.mpv_free.argtypes = [c_void_p]
m.mpv_error_string.restype = c_char_p

def prop(h, name):
    p = m.mpv_get_property_string(h, name.encode())
    if not p: return None
    s = ctypes.string_at(p).decode("utf8", "replace"); m.mpv_free(p); return s

def run(url, headers, seconds=20, ua=None, verbose=False):
    h = m.mpv_create()
    for k, v in [("vo","null"),("ao","null"),("hwdec","no"),("terminal","no"),("idle","no"),("keep-open","no")]:
        m.mpv_set_option_string(h, k.encode(), v.encode())
    if ua: m.mpv_set_option_string(h, b"user-agent", ua.encode())
    if headers: m.mpv_set_option_string(h, b"http-header-fields", headers.encode())
    assert m.mpv_initialize(h) >= 0
    m.mpv_request_log_messages(h, b"v" if verbose else b"warn")
    args = (c_char_p * 4)(b"loadfile", url.encode(), b"replace", None)
    print("loadfile ->", m.mpv_error_string(m.mpv_command(h, args)).decode())
    t0 = time.time(); loaded = False; ended = None; last = None; samples = []
    while time.time() - t0 < seconds:
        e = m.mpv_wait_event(h, 0.5).contents
        if e.event_id == 0:
            if loaded:
                tp = prop(h, "time-pos")
                if tp: samples.append(float(tp))
            continue
        if e.event_id == 2:
            lm = ctypes.cast(e.data, POINTER(LogMsg)).contents
            txt = (lm.text or b"").decode("utf8","replace").strip()
            if txt: print("  [%s] %s" % ((lm.prefix or b"").decode(), txt[:200]))
        elif e.event_id == 8:
            loaded = True
            print("FILE_LOADED  video:", prop(h,"video-params/w"), "x", prop(h,"video-params/h"), " acodec:", prop(h,"audio-codec-name"), " vcodec:", prop(h,"video-codec"))
            print("  duration:", prop(h,"duration"))
            tl = prop(h, "track-list/count"); print("  tracks:", tl)
            for i in range(int(tl or 0)):
                print("   ", prop(h, f"track-list/{i}/type"), prop(h, f"track-list/{i}/lang"), prop(h, f"track-list/{i}/codec"), "sel=", prop(h, f"track-list/{i}/selected"))
        elif e.event_id == 7:
            ef = ctypes.cast(e.data, POINTER(EndFile)).contents
            ended = (ef.reason, ef.error); print("END_FILE reason", ef.reason, "error", m.mpv_error_string(ef.error).decode()); break
    print("time-pos samples:", [round(s,1) for s in samples[:: max(1,len(samples)//8)]], "final", samples[-1] if samples else None)
    m.mpv_terminate_destroy(c_void_p(h)) if False else None
    return loaded, ended, samples


# Real-time probe of an EDL/URL in the app's libmpv. Built on the known-good runner.py structure.
from ctypes import c_char_p
url = open(sys.argv[1], encoding="utf8").read().strip() if os.path.exists(sys.argv[1]) else sys.argv[1]
secs = int(sys.argv[2]) if len(sys.argv) > 2 else 40
seeks = [float(x) for x in sys.argv[3].split(",")] if len(sys.argv) > 3 and sys.argv[3] else []
extra = dict(kv.split("=", 1) for kv in sys.argv[4:] if "=" in kv)          # extra mpv options, k=v
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36"
h = m.mpv_create()
if os.environ.get("UA_IN_HEADERS"):
    _UAF = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36"
    base = [("vo","null"),("ao","null"),("hwdec","no"),("terminal","no"),("idle","no"),("keep-open","yes"),
            ("http-header-fields","User-Agent: " + _UAF + ",Referer: https://senshi.to/,Origin: https://senshi.to")]
else:
    base = [("vo","null"),("ao","null"),("hwdec","no"),("terminal","no"),("idle","no"),("keep-open","yes"),
            ("user-agent", UA), ("http-header-fields","Referer: https://senshi.to/,Origin: https://senshi.to")]
for k, v in base + list(extra.items()): m.mpv_set_option_string(h, k.encode(), v.encode())
assert m.mpv_initialize(h) >= 0
m.mpv_request_log_messages(h, b"v" if os.environ.get("VERBOSE") else b"warn")
by_prefix = {}; first_err_time = {}
def pump(limit):
    end = time.time() + limit
    while time.time() < end:
        e = m.mpv_wait_event(h, 0.1).contents
        if e.event_id == 2:
            lm = ctypes.cast(e.data, POINTER(LogMsg)).contents
            t = (lm.text or b"").decode("utf8", "replace").strip()[:60]; pf = (lm.prefix or b"").decode()
            key = pf + " | " + t; by_prefix[key] = by_prefix.get(key, 0) + 1
            if os.environ.get("VERBOSE") and any(w in t.lower() for w in ("unsafe", "refus", "playlist", "edl", "open", "fail", "load")): print("     [%s] %s" % (pf, t))
        elif e.event_id == 7:
            return "END"
    return None
t0 = time.time()
if os.environ.get("LOADLIST"):
    import tempfile
    tf = tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8"); tf.write(url); tf.close()
    mode = os.environ.get("LOADLIST")            # "replace" or "append"
    print("open via loadlist", mode, "->", m.mpv_error_string(m.mpv_command(h, (c_char_p * 4)(b"loadlist", tf.name.encode(), mode.encode(), None))).decode())
    if mode == "append":
        m.mpv_command(h, (c_char_p * 4)(b"set", b"pause", b"no", None)); m.mpv_command(h, (c_char_p * 4)(b"set", b"playlist-pos", b"0", None))
else:
    m.mpv_command(h, (c_char_p * 4)(b"loadfile", url.encode(), b"replace", None))
loaded = None
while time.time() - t0 < 30 and loaded is None:
    e = m.mpv_wait_event(h, 0.1).contents
    if e.event_id == 8: loaded = time.time() - t0
print("loaded after", None if loaded is None else round(loaded, 2), "s | duration", prop(h, "duration"),
      "| tracks:", [(prop(h, "track-list/%d/type" % i), prop(h, "track-list/%d/lang" % i)) for i in range(int(prop(h, "track-list/count") or 0))])
if loaded is None: sys.exit(1)
rows = []; start = time.time(); last_frames = None
print("  wall  time-pos  frames(est)  fps   avsync  cache-ahead  paused-for-cache  PPS-errs-so-far")
while time.time() - start < secs:
    if pump(1.0) == "END": print("END_FILE"); break
    w = int(time.time() - start)
    if w % 5 == 0 and (not rows or rows[-1] != w):
        rows.append(w)
        fr = prop(h, "estimated-frame-number"); fr_i = int(fr) if fr and fr.isdigit() else None
        fps = "" if (fr_i is None or last_frames is None) else "%.1f" % ((fr_i - last_frames) / 5.0)
        last_frames = fr_i
        pps = sum(v for k, v in by_prefix.items() if "PPS" in k)
        print("  %3ds  %8s  %10s  %5s  %6s  %10s  %16s  %d" % (w, prop(h, "time-pos") and prop(h, "time-pos")[:7], fr, fps, (prop(h, "avsync") or "")[:6], (prop(h, "demuxer-cache-duration") or "")[:6], prop(h, "paused-for-cache"), pps))
for t in seeks:
    m.mpv_command(h, (c_char_p * 4)(b"seek", str(t).encode(), b"absolute", None)); s0 = time.time(); pump(7)
    print("seek", t, "-> time-pos", prop(h, "time-pos"), "| seeking", prop(h, "seeking"), "| A/V", prop(h, "avsync"))
pump(3)
print("final time-pos", prop(h, "time-pos"), "| dropped dec/vo", prop(h, "decoder-frame-drop-count"), prop(h, "frame-drop-count"))
print("log lines by source (top):")
for k, v in sorted(by_prefix.items(), key=lambda x: -x[1])[:7]: print("  %5d x %s" % (v, k))
