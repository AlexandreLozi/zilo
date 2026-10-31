# Prior ChatGPT conversation (starting point, not binding)

Source: https://chatgpt.com/share/6ae60218-3788-83e9-a199-031f8b1f4be3

## User

Whats needed to build a scan software like web twain to stop paying them for their driver to read scanners?

## ChatGPT answer

**You can absolutely build your own alternative to Dynamic Web TWAIN and stop paying Dynamsoft licensing fees.** The interesting part is that you don't need to develop scanner drivers yourself. You can use the drivers and scanning interfaces that already exist in Windows, macOS, and Linux.

Even better, there's an open-source library called <Entity category="software" value="NAPS2 SDK" disambig="Open-source document scanning SDK"/> that could eliminate a substantial amount of the development effort.

The main challenge isn't actually scanning documents. It's making physical scanners accessible from a web application reliably and securely.

## 1. How Web TWAIN actually works

Dynamic Web TWAIN is effectively a bridge between your website and a scanner connected to the user's computer.

<box border radius="xl" padding={3} gap={2}>
  <svg viewBox="0 0 340 278" width="100%" xmlns="http://www.w3.org/2000/svg">
    {#each [{y:8,title:"Your web application",sub:"React / JavaScript / TypeScript",fill:"#E4EEFE",stroke:"#6396E5"},{y:80,title:"Local scanning service",sub:"HTTP API on localhost",fill:"#DDF4E7",stroke:"#53A982"},{y:152,title:"Scanner interface",sub:"TWAIN / WIA / eSCL / SANE",fill:"#F3E8FA",stroke:"#B58AD7"},{y:224,title:"Physical scanner",sub:"USB or local network",fill:"#F4EBDE",stroke:"#CA9C56"}] as b,i}
      <rect x="24" y={b.y} width="292" height="47" rx="8" fill={b.fill} stroke={b.stroke}/>
      <text x="170" y={b.y+19} textAnchor="middle" fontSize="13" fontWeight="600" fill="#253040">{b.title}</text>
      <text x="170" y={b.y+35} textAnchor="middle" fontSize="10" fill="#4D5D69">{b.sub}</text>
      {#if i<3}
        <path d={`M170 ${b.y+48} v21 m-4 -5 l4 5 4 -5`} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      {/if}
    {/each}
  </svg>
  <caption textAlign="center">Simplified architecture of a browser-based scanning solution</caption>
</box>

Here's what happens when someone clicks **Scan Document**:

1. The browser sends a request to a small application running locally.
2. The local application communicates with the scanner through an existing driver or scanning protocol.
3. The scanner captures one or more pages.
4. The local application returns the images or PDF to the browser.
5. Your web application previews, processes, or uploads the document.

Dynamsoft uses this same general architecture with its local Dynamic Web TWAIN Service. <Cite refs={["turn932435search0","turn932435search2"]}/>

You would be replacing their software layer, **not the scanner's manufacturer-provided driver**.

## 2. Which technologies would you need?

| Component | Recommended technology | Complexity |
|---|---|---|
| Scanner integration | NAPS2 SDK (.NET/C#) | Medium |
| Local background service | ASP.NET Core Minimal API | Low–medium |
| Browser communication | HTTP on localhost | Low–medium |
| Frontend | React + TypeScript | Low |
| PDF generation | NAPS2 / PDF library | Low |
| Installation | Windows MSI or EXE | Medium |
| Security and compatibility | Local authentication, HTTPS/CORS controls, device testing | Medium–high |

For a Windows-first application, I'd use **C#/.NET for the local scanner service and TypeScript for the web integration**.

Even if your existing backend is Python, Java, or Node.js, the local service can remain completely independent.

## 3. There's already an example of exactly what you want

I found an especially relevant GitHub repository:

<row align="center" gap={3}>
  <AsyncImage query="NAPS2 document scanning software application screenshot Windows scan interface" aspectRatio="5:4" maxWidth="136px"/>
  <box flex="1" gap={1}>
    **<Link url="https://github.com/cyanfish/naps2-webscan" title="NAPS2 WebScan on GitHub"/>**

    An example project that lets JavaScript/TypeScript web applications scan documents through a locally installed Windows service.
  </box>
</row>

It already includes two important pieces:

- `NAPS2.WebScan.LocalService`: a Windows service that exposes scanners through an eSCL interface.
- `NAPS2.WebScan.WebServer`: an example of accessing that scanning functionality from JavaScript/TypeScript.

This is a reference implementation, not a production-ready replacement, but it directly demonstrates the architecture you're looking for. <Cite ref="turn398475search0"/>

## 4. What features would you actually need to develop?

Here's how I'd scope the first version.

{@body const features=[{name:"Detect available scanners",level:"Easy",essential:true},{name:"Start scan from browser",level:"Medium",essential:true},{name:"Choose DPI, color, paper size",level:"Medium",essential:true},{name:"Scan multiple pages (ADF)",level:"Medium",essential:true},{name:"Duplex scanning",level:"Medium",essential:true},{name:"Return PDF or images",level:"Easy",essential:true},{name:"Preview pages in browser",level:"Easy",essential:false},{name:"Rotate, crop, reorder pages",level:"Medium",essential:false},{name:"OCR / searchable PDF",level:"Medium",essential:false},{name:"Cross-platform support",level:"Hard",essential:false},{name:"Installer and automatic updates",level:"Hard",essential:false}]}
{@body const [chosen,setChosen]=DIL.useState(features.map(f=>f.essential))}
<box border radius="xl" padding={3} gap={3}>
  <row justify="between" align="center">
    **Feature checklist for your replacement**
    <text color="secondary" size="xs" tabularNums>{chosen.filter(Boolean).length} of {features.length} selected</text>
  </row>
  {#each features as f,i}
    <row align="center" justify="between" key={f.name}>
      <box flex="1">
        <checkbox checked={chosen[i]} onChange={v=>setChosen(old=>old.map((x,j)=>i===j?v:x))} lineThrough={false}>{f.name}</checkbox>
      </box>
      <text color="secondary" size="xs">{f.level}</text>
    </row>
  {/each}
  <button block onClick={()=>GenUI.issueNewTurn("Design a technical MVP implementation plan for my Web TWAIN replacement using NAPS2 SDK, C# local service and React. Include these features: "+features.filter((f,i)=>chosen[i]).map(f=>f.name).join(", ")+". Include architecture, endpoint contracts, security, and implementation order.")}>Create implementation plan for selected features <icon name="arrow-right" inline/></button>
</box>

## 5. Example of how the API could work

Your local service could expose just three endpoints initially:

```http
GET http://127.0.0.1:17890/api/scanners

GET http://127.0.0.1:17890/api/scanners/{id}/capabilities

POST http://127.0.0.1:17890/api/scan
```

The web application might issue a request like this:

```javascript
const response = await fetch(
  "http://127.0.0.1:17890/api/scan",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${localToken}`
    },
    body: JSON.stringify({
      scannerId: "scanner-001",
      dpi: 300,
      colorMode: "color",
      source: "feeder",
      duplex: true,
      format: "pdf"
    })
  }
);

const pdf = await response.blob();
```

This is an illustrative API design, not an existing NAPS2 endpoint.

For production, you'd need secure client pairing, origin validation, access control, and appropriate CORS configuration. Modern browsers also apply local-network access permissions when public websites communicate with localhost. <Cite ref="turn398475search2"/>

## 6. How difficult is the project?

These are my rough engineering estimates for one experienced developer, assuming hardware is available for testing.

| Scope | Estimated effort |
|---|---|
| Proof of concept: one Windows scanner | 2–5 days |
| Windows MVP: basic scanning and PDF | 2–4 weeks |
| Production-ready Windows version | 1–3 months |
| Broad cross-platform alternative | 3–6+ months |

These are development estimates, not guarantees. The number and variety of supported scanner models can change the effort dramatically.

The biggest complications are usually hardware compatibility, paper feeder behavior, error recovery, installation, and driver differences. For example, TWAIN sometimes requires a 32-bit worker process even when your application is 64-bit; NAPS2 already provides support for this. <Cite ref="turn932435search1"/>

One more important point: **licensing**. The NAPS2 SDK is LGPL-2.1-or-later, while the main NAPS2 application is GPL-2.0-or-later. Using the SDK in commercial software may be possible, but you'll need to comply with the LGPL requirements and check the licenses of all packaged components. <Cite ref="turn932435search9"/>

## My recommendation

I wouldn't develop your own TWAIN driver implementation or build the entire scanner integration stack from scratch. I'd start by cloning `naps2-webscan`, getting it working against your actual scanners, and evaluating the NAPS2 SDK as the foundation.

That could turn a substantial driver-integration project into a much smaller local-service and frontend-integration project.

**One important question:** Is your company currently using Dynamic Web TWAIN in a web application deployed to multiple customers or offices, where each computer has its own scanner?

Or are you only using it internally with a few known scanner models?

That distinction matters enormously: supporting 5–10 known models on Windows is a very different project from building a reliable replacement for hundreds of different scanners across customer environments.

---

If you want, I can:

- Design a detailed MVP implementation plan using NAPS2 SDK and React
- Explain how to securely authorize and authenticate local scanner service requests
- Outline cross-platform support challenges beyond Windows for scanner access
