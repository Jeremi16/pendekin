package link

import (
	"html/template"
	"log"
	"net/http"
)

// page is rendered for visitors hitting /{code} when they can't be redirected
// straight away (not found, inactive, expired, password-protected) or asked
// for a preview.
type page struct {
	Title    string
	Message  string
	Form     bool
	Error    string
	Dest     string // preview: destination URL ("" when hidden)
	Continue string // preview: path that performs the real redirect
}

var pageTmpl = template.Must(template.New("page").Parse(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>{{.Title}} · pendekin</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;
background:radial-gradient(ellipse 60% 40% at 50% 0%,rgba(255,255,255,.05),transparent),#0a0a0a;
color:#ededed;font-family:Geist,Inter,"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.card{width:100%;max-width:380px;border:1px solid #262626;background:#0d0d0d;border-radius:24px;padding:28px}
.k{font-size:10px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:#737373;margin:0}
h1{font-size:24px;font-weight:500;letter-spacing:-.02em;margin:8px 0 4px}
p.m{color:#737373;font-size:14px;margin:0 0 20px}
input{width:100%;border:1px solid #262626;background:#171717;color:#f5f5f5;border-radius:999px;padding:12px 18px;font:inherit;font-size:14px;outline:none}
input:focus{border-color:#525252}
button,a.b{display:block;width:100%;margin-top:12px;border:0;border-radius:999px;background:#fff;color:#000;padding:12px;font:inherit;font-size:14px;font-weight:600;cursor:pointer;text-align:center;text-decoration:none}
button:hover,a.b:hover{background:#e5e5e5}
.d{word-break:break-all;border:1px solid #262626;background:#171717;border-radius:16px;padding:12px 14px;font-size:13px;color:#d4d4d4;margin:0 0 4px}
.e{margin:12px 0 0;border:1px solid rgba(127,29,29,.6);background:rgba(69,10,10,.4);color:#fca5a5;border-radius:16px;padding:10px 14px;font-size:14px}
</style></head><body>
<main class="card">
<p class="k">pendekin</p>
<h1>{{.Title}}</h1>
<p class="m">{{.Message}}</p>
{{if .Form}}<form method="post" autocomplete="off">
<label class="k" for="pw" style="display:block;margin:0 0 6px 4px">Password</label>
<input id="pw" name="password" type="password" required autofocus maxlength="128">
{{if .Error}}<p class="e">{{.Error}}</p>{{end}}
<button type="submit">Continue →</button>
</form>{{else if .Continue}}<p class="d">{{if .Dest}}{{.Dest}}{{else}}A password-protected destination{{end}}</p>
<a class="b" href="{{.Continue}}" rel="noreferrer">Continue →</a>{{else}}<a class="b" href="/">Create your own short link</a>{{end}}
</main></body></html>`))

func renderPage(w http.ResponseWriter, status int, p page) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.WriteHeader(status)
	if err := pageTmpl.Execute(w, p); err != nil {
		log.Printf("[WARN] render page: %v", err)
	}
}

func (l *Link) hasOG() bool {
	return l.OgTitle != nil || l.OgDescription != nil || l.OgImage != nil
}

// ogTmpl is served only to social crawlers so shares show the owner's custom
// preview; real visitors are redirected before this is reached.
var ogTmpl = template.Must(template.New("og").Parse(`<!doctype html>
<html><head><meta charset="utf-8">
<title>{{.Title}}</title>
<meta property="og:type" content="website">
<meta property="og:url" content="{{.URL}}">
<meta property="og:title" content="{{.Title}}">
{{if .Description}}<meta property="og:description" content="{{.Description}}"><meta name="description" content="{{.Description}}">{{end}}
{{if .Image}}<meta property="og:image" content="{{.Image}}"><meta name="twitter:image" content="{{.Image}}">{{end}}
<meta name="twitter:card" content="{{if .Image}}summary_large_image{{else}}summary{{end}}">
<meta name="twitter:title" content="{{.Title}}">
</head><body></body></html>`))

func renderOG(w http.ResponseWriter, l *Link) {
	d := struct{ URL, Title, Description, Image string }{URL: l.Short, Title: l.Short}
	if l.OgTitle != nil {
		d.Title = *l.OgTitle
	} else if l.Title != nil {
		d.Title = *l.Title
	}
	if l.OgDescription != nil {
		d.Description = *l.OgDescription
	}
	if l.OgImage != nil {
		d.Image = *l.OgImage
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if err := ogTmpl.Execute(w, d); err != nil {
		log.Printf("[WARN] render og: %v", err)
	}
}
