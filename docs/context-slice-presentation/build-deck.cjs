#!/usr/bin/env node
/**
 * Context Slice / Descobrir — 15-slide technical deck generator.
 * Uses pptxgenjs. Follows all documented gotchas.
 * Target: docs/context-slice-presentation/context-slice-descobrir.pptx
 */

const PptxGenJS = require("pptxgenjs");
const fs = require("fs");
const path = require("path");

// === DESIGN SYSTEM (dark technical, high contrast) ===
const DESIGN = Object.freeze({
  // Backgrounds
  bg0: "0E1013", // slide background
  bg1: "1D2026", // card/panel
  bg2: "16181D", // secondary panel
  bg3: "23262D", // border tint

  // Text
  text: "E6E8EC",
  text2: "9BA1AC",
  text3: "6B717F",

  // Accent
  accent: "7C6CFF",
  accentSoft: "4A3F99",

  // Semantic
  observed: "3ECF8E",
  inferred: "E8A33D",
  missing: "FF5C5C",
  frontier: "6F8196",

  // Fonts (safe Office)
  title: "Cambria",
  body: "Calibri",
  mono: "Courier New",

  // Layout (LAYOUT_WIDE = 13.3" × 7.5")
  margin: 0.5,
  cardGap: 0.35,
});

// === HELPERS (fresh objects every call) ===
function makeShadow() {
  return { type: "outer", color: "000000", blur: 8, offset: 3, opacity: 0.35 };
}

function addTitleBar(slide, title, subtitle) {
  slide.addText(title, {
    x: DESIGN.margin,
    y: 0.35,
    w: 12.3,
    h: 0.6,
    fontFace: DESIGN.title,
    fontSize: 32,
    bold: true,
    color: DESIGN.text,
    margin: 0,
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: DESIGN.margin,
      y: 0.9,
      w: 12.3,
      h: 0.35,
      fontFace: DESIGN.body,
      fontSize: 14,
      color: DESIGN.text2,
      margin: 0,
    });
  }
}

function addFooter(slide, pageNum) {
  slide.addText(`Context Slice · Descobrir  •  slide ${pageNum}/18`, {
    x: DESIGN.margin,
    y: 7.1,
    w: 12.3,
    h: 0.25,
    fontFace: DESIGN.body,
    fontSize: 9,
    color: DESIGN.text3,
    margin: 0,
  });
}

function addCard(slide, x, y, w, h, title, bodyLines, accentColor) {
  slide.addShape("roundedRectangle", {
    x,
    y,
    w,
    h,
    fill: { color: DESIGN.bg1 },
    line: { color: DESIGN.bg3, width: 1 },
    rectRadius: 0.08,
    shadow: makeShadow(),
  });
  slide.addText(title, {
    x: x + 0.15,
    y: y + 0.12,
    w: w - 0.3,
    h: 0.32,
    fontFace: DESIGN.body,
    fontSize: 13,
    bold: true,
    color: accentColor || DESIGN.accent,
    margin: 0,
  });
  if (bodyLines && bodyLines.length) {
    const textItems = bodyLines.map((line, idx) => ({
      text: line,
      options: {
        fontFace: DESIGN.body,
        fontSize: 11,
        color: DESIGN.text2,
        breakLine: idx < bodyLines.length - 1,
      },
    }));
    slide.addText(textItems, {
      x: x + 0.15,
      y: y + 0.45,
      w: w - 0.3,
      h: h - 0.6,
      valign: "top",
      margin: 0,
    });
  }
}

function addCodeBlock(slide, x, y, w, h, title, code) {
  slide.addShape("roundedRectangle", {
    x,
    y,
    w,
    h,
    fill: { color: "0A0C0F" },
    line: { color: DESIGN.bg3, width: 1 },
    rectRadius: 0.06,
  });
  if (title) {
    slide.addText(title, {
      x: x + 0.12,
      y: y + 0.08,
      w: w - 0.24,
      h: 0.26,
      fontFace: DESIGN.mono,
      fontSize: 10,
      color: DESIGN.accent,
      margin: 0,
    });
  }
  slide.addText(code, {
    x: x + 0.12,
    y: y + (title ? 0.34 : 0.1),
    w: w - 0.24,
    h: h - (title ? 0.44 : 0.2),
    fontFace: DESIGN.mono,
    fontSize: 9,
    color: DESIGN.text,
    valign: "top",
    margin: 0,
  });
}

// Graph node — supports simple (slide 2) and rich (slide 4) variants.
// opts: { kind, kindColor, name, nameAlign, subtitle, evidence, isFrontier, borderColor }
function addGraphNode(slide, x, y, w, h, opts) {
  const isFrontier = !!opts.isFrontier;
  const border = opts.borderColor || (isFrontier ? DESIGN.frontier : DESIGN.accent);
  slide.addShape("roundedRectangle", {
    x,
    y,
    w,
    h,
    fill: { color: DESIGN.bg1 },
    line: { color: border, width: 1.5, dashType: isFrontier ? "dash" : "solid" },
    rectRadius: 0.06,
    shadow: makeShadow(),
  });
  const hasKind = !!opts.kind;
  if (hasKind) {
    const chipW = Math.min(1.05, w * 0.36);
    const chipH = 0.22;
    slide.addShape("roundedRectangle", {
      x: x + 0.08,
      y: y + 0.08,
      w: chipW,
      h: chipH,
      fill: { color: opts.kindColor || border },
      rectRadius: 0.03,
    });
    slide.addText(opts.kind, {
      x: x + 0.08,
      y: y + 0.08,
      w: chipW,
      h: chipH,
      fontFace: DESIGN.mono,
      fontSize: 8,
      bold: true,
      color: DESIGN.text,
      align: "center",
      valign: "middle",
      margin: 0,
    });
    slide.addText(opts.name, {
      x: x + chipW + 0.16,
      y: y + 0.07,
      w: w - chipW - 0.24,
      h: 0.24,
      fontFace: DESIGN.body,
      fontSize: 10,
      bold: true,
      color: DESIGN.text,
      align: "left",
      valign: "middle",
      margin: 0,
    });
    if (opts.subtitle) {
      slide.addText(opts.subtitle, {
        x: x + 0.1,
        y: y + 0.35,
        w: w - 0.2,
        h: 0.2,
        fontFace: DESIGN.mono,
        fontSize: 8,
        color: opts.kindColor || border,
        margin: 0,
      });
    }
    if (opts.evidence) {
      slide.addText(opts.evidence, {
        x: x + 0.1,
        y: y + h - 0.26,
        w: w - 0.2,
        h: 0.2,
        fontFace: DESIGN.mono,
        fontSize: 7.5,
        color: DESIGN.text3,
        margin: 0,
      });
    }
  } else {
    slide.addText(opts.name, {
      x,
      y: y + (h - 0.34) / 2,
      w,
      h: 0.34,
      fontFace: DESIGN.body,
      fontSize: 12,
      bold: true,
      color: DESIGN.text,
      align: opts.nameAlign || "center",
      margin: 0,
    });
  }
}

// Edge label + optional evidence chip stacked vertically, centered on (x, y, w).
function addEdgeLabel(slide, x, y, w, label, evidence, color) {
  const labelColor = color || DESIGN.observed;
  slide.addText(label, {
    x,
    y,
    w,
    h: 0.2,
    fontFace: DESIGN.mono,
    fontSize: 9,
    bold: true,
    color: labelColor,
    align: "center",
    margin: 0,
  });
  if (evidence) {
    slide.addText(evidence, {
      x,
      y: y + 0.2,
      w,
      h: 0.18,
      fontFace: DESIGN.mono,
      fontSize: 8,
      color: DESIGN.text3,
      align: "center",
      margin: 0,
    });
  }
}

function addTable(slide, x, y, w, h, headers, rows, colWidths) {
  const tableData = [
    headers.map((h) => ({
      text: h,
      options: {
        fill: { color: DESIGN.accentSoft },
        color: DESIGN.text,
        fontFace: DESIGN.body,
        fontSize: 10,
        bold: true,
        align: "left",
      },
    })),
    ...rows.map((row) =>
      row.map((cell) => ({
        text: String(cell),
        options: {
          fill: { color: DESIGN.bg1 },
          color: DESIGN.text2,
          fontFace: DESIGN.body,
          fontSize: 9,
          align: "left",
        },
      })),
    ),
  ];
  slide.addTable(tableData, {
    x,
    y,
    w,
    h,
    colW: colWidths,
    border: { type: "solid", pt: 0.5, color: DESIGN.bg3 },
    fontFace: DESIGN.body,
    fontSize: 9,
    color: DESIGN.text2,
    valign: "middle",
  });
}

// === SLIDE BUILDERS ===

function buildSlide01(pres) {
  const slide = pres.addSlide();
  slide.background = { color: DESIGN.bg0 };

  // Large title
  slide.addText("Do código ao Context Slice", {
    x: 0.8,
    y: 2.2,
    w: 11.7,
    h: 1.0,
    fontFace: DESIGN.title,
    fontSize: 44,
    bold: true,
    color: DESIGN.text,
    margin: 0,
  });

  slide.addText("O pipeline determinístico que transforma um repositório em contexto verificável para agentes e humanos.", {
    x: 0.8,
    y: 3.3,
    w: 11.7,
    h: 0.6,
    fontFace: DESIGN.body,
    fontSize: 18,
    color: DESIGN.text2,
    margin: 0,
  });

  // Pipeline motif (5 boxes + arrows)
  const boxes = [
    { label: "Graphify", x: 1.0 },
    { label: "Explorer", x: 3.4 },
    { label: "Finalize", x: 5.8 },
    { label: "L0→L1→L2", x: 8.2 },
    { label: "Slice", x: 10.6 },
  ];
  boxes.forEach((b, i) => {
    slide.addShape("roundedRectangle", {
      x: b.x,
      y: 4.8,
      w: 1.8,
      h: 0.7,
      fill: { color: i === 4 ? DESIGN.accent : DESIGN.bg1 },
      line: { color: DESIGN.bg3, width: 1 },
      rectRadius: 0.06,
    });
    slide.addText(b.label, {
      x: b.x,
      y: 4.95,
      w: 1.8,
      h: 0.4,
      fontFace: DESIGN.body,
      fontSize: 12,
      bold: true,
      color: DESIGN.text,
      align: "center",
      margin: 0,
    });
    if (i < boxes.length - 1) {
      slide.addShape("rightArrow", {
        x: b.x + 1.85,
        y: 5.0,
        w: 0.45,
        h: 0.3,
        fill: { color: DESIGN.text3 },
      });
    }
  });

  slide.addNotes("Capa. Apresenta o tema: do código-fonte até o Context Slice — a unidade determinística de contexto. O pipeline é Graphify → Explorer → Finalize + Human Gate → L0/L1/L2 → Slice → Pack. O deck explica cada camada com o modelo de dados real.");

  addFooter(slide, 1);
}

function buildSlide02(pres) {
  const slide = pres.addSlide();
  slide.background = { color: DESIGN.bg0 };
  addTitleBar(slide, "O que é um grafo", "entities + relations + proof — a unidade visual do conhecimento");
  addFooter(slide, 2);

  // === GEOMETRY ===
  // Circles on a 3x2 grid; edges are straight lines (horizontal or vertical).
  // Generic graph first — no code/service names here.
  const d = 1.1;                                   // circle diameter
  const topY = 1.7;                                // top row top-left y   (center 2.25)
  const botY = 3.45;                               // bottom row top-left y (center 4.0)
  const colA = 1.75, colB = 5.55, colC = 9.45;     // top-left x per column
  const lineY = topY + d / 2;                      // horizontal edge y (= top row center)
  const vTop = topY + d;                           // vertical edge start (top row bottom)
  const vBot = botY;                               // vertical edge end (bottom row top)

  // === EDGES FIRST (so circles overlap the ends cleanly) ===
  // Horizontal: A->B (calls), B->C (depends_on)
  slide.addShape("line", { x: colA + d, y: lineY, w: colB - (colA + d), h: 0,
    line: { color: DESIGN.observed, width: 2, endArrowType: "triangle" } });
  slide.addShape("line", { x: colB + d, y: lineY, w: colC - (colB + d), h: 0,
    line: { color: DESIGN.observed, width: 2, endArrowType: "triangle" } });
  // Vertical: A->D (reads), B->E (publishes), C->External (http_call)
  slide.addShape("line", { x: colA + d / 2, y: vTop, w: 0, h: vBot - vTop,
    line: { color: DESIGN.observed, width: 2, endArrowType: "triangle" } });
  slide.addShape("line", { x: colB + d / 2, y: vTop, w: 0, h: vBot - vTop,
    line: { color: DESIGN.inferred, width: 2, endArrowType: "triangle" } });
  slide.addShape("line", { x: colC + d / 2, y: vTop, w: 0, h: vBot - vTop,
    line: { color: DESIGN.inferred, width: 2, dashType: "dash", endArrowType: "triangle" } });

  // === EDGE LABELS + EVIDENCE CHIPS ===
  // Horizontal: centered in the gap, just above the line.
  addEdgeLabel(slide, colA + d, 1.8, colB - (colA + d), "calls", "file:42", DESIGN.observed);
  addEdgeLabel(slide, colB + d, 1.8, colC - (colB + d), "depends_on", "file:8", DESIGN.observed);
  // Vertical: left-aligned beside the line, in the inter-row gap.
  const vLabel = (xLine, label, evidence, color) => {
    slide.addText(label, { x: xLine + 0.1, y: 2.9, w: 1.3, h: 0.2,
      fontFace: DESIGN.mono, fontSize: 9, bold: true, color, margin: 0 });
    slide.addText(evidence, { x: xLine + 0.1, y: 3.1, w: 1.4, h: 0.18,
      fontFace: DESIGN.mono, fontSize: 8, color: DESIGN.text3, margin: 0 });
  };
  vLabel(colA + d / 2, "reads", "schema.sql:12", DESIGN.observed);
  vLabel(colB + d / 2, "publishes", "config.yml:8", DESIGN.inferred);
  vLabel(colC + d / 2, "http_call", "config.yml:3", DESIGN.inferred);

  // === NODES (visible circles, not boxes) ===
  const circles = [
    { x: colA, y: topY, name: "Node A", color: DESIGN.accent },
    { x: colB, y: topY, name: "Node B", color: DESIGN.accent },
    { x: colC, y: topY, name: "Node C", color: DESIGN.accent },
    { x: colA, y: botY, name: "Node D", color: DESIGN.accent },
    { x: colB, y: botY, name: "Node E", color: DESIGN.accent },
    { x: colC, y: botY, name: "External", color: DESIGN.frontier, dashed: true },
  ];
  circles.forEach((n) => {
    slide.addShape("ellipse", {
      x: n.x, y: n.y, w: d, h: d,
      fill: { color: DESIGN.bg1 },
      line: { color: n.color, width: 2, dashType: n.dashed ? "dash" : "solid" },
      shadow: makeShadow(),
    });
    slide.addText(n.name, {
      x: n.x, y: n.y, w: d, h: d,
      fontFace: DESIGN.body, fontSize: 12, bold: true,
      color: DESIGN.text, align: "center", valign: "middle", margin: 0,
    });
  });

  // === LEGEND (3 cards: NODE / EDGE / EVIDENCE) ===
  const legendY = 4.7;
  const legends = [
    {
      x: 0.6, swatch: "circle", color: DESIGN.accent, title: "NODE",
      lines: [
        "Círculo = entidade genérica.",
        "Aqui: Node A … Node E + External.",
        "Na prática: tipo + id + nome.",
      ],
    },
    {
      x: 4.75, swatch: "line", color: DESIGN.observed, title: "EDGE",
      lines: [
        "Linha = conexão tipada.",
        "calls · depends_on · reads",
        "publishes · http_call",
      ],
    },
    {
      x: 8.9, swatch: "chip", color: DESIGN.inferred, title: "EVIDENCE",
      lines: [
        "Chip = prova da aresta.",
        "file:42 · config.yml:8",
        "schema.sql:12 · config.yml:3",
      ],
    },
  ];
  legends.forEach((l) => {
    slide.addShape("roundedRectangle", {
      x: l.x, y: legendY, w: 3.8, h: 1.2,
      fill: { color: DESIGN.bg1 }, line: { color: DESIGN.bg3, width: 1 },
      rectRadius: 0.06, shadow: makeShadow(),
    });
    // swatch reinforces the motif (circle / line / chip)
    if (l.swatch === "circle") {
      slide.addShape("ellipse", { x: l.x + 0.18, y: legendY + 0.16, w: 0.3, h: 0.3,
        fill: { color: l.color } });
    } else if (l.swatch === "line") {
      slide.addShape("line", { x: l.x + 0.18, y: legendY + 0.31, w: 0.3, h: 0,
        line: { color: l.color, width: 2, endArrowType: "triangle" } });
    } else {
      slide.addShape("roundedRectangle", { x: l.x + 0.18, y: legendY + 0.2, w: 0.3, h: 0.22,
        fill: { color: l.color }, rectRadius: 0.04 });
    }
    slide.addText(l.title, {
      x: l.x + 0.6, y: legendY + 0.14, w: 3.05, h: 0.34,
      fontFace: DESIGN.body, fontSize: 13, bold: true,
      color: l.color, valign: "middle", margin: 0,
    });
    const textItems = l.lines.map((s, i) => ({
      text: s,
      options: { breakLine: i < l.lines.length - 1 },
    }));
    slide.addText(textItems, {
      x: l.x + 0.2, y: legendY + 0.52, w: 3.45, h: 0.62,
      fontFace: DESIGN.body, fontSize: 10, color: DESIGN.text2, margin: 0,
    });
  });

  // === TAKEAWAY (single required sentence) ===
  slide.addShape("roundedRectangle", {
    x: 0.6, y: 6.05, w: 12.1, h: 0.7,
    fill: { color: DESIGN.bg2 }, line: { color: DESIGN.bg3, width: 1 },
    rectRadius: 0.06,
  });
  slide.addText([
    { text: "Antes de ser ", options: { color: DESIGN.text2 } },
    { text: "ClienteService", options: { bold: true, color: DESIGN.text } },
    { text: " ou ", options: { color: DESIGN.text2 } },
    { text: "Address API", options: { bold: true, color: DESIGN.text } },
    { text: ", é só isso: círculos conectados por relações com evidência.", options: { color: DESIGN.text2 } },
  ], {
    x: 0.8, y: 6.15, w: 11.7, h: 0.5,
    fontFace: DESIGN.body, fontSize: 12, margin: 0,
  });

  slide.addNotes("Slide conceitual: o que é um grafo, fora de qualquer código. Seis círculos (Node A–E + External) ligados por cinco arestas tipadas — calls, depends_on, reads, publishes, http_call — cada uma com seu evidence chip (file:42, config.yml:8, schema.sql:12, ...). External tem borda tracejada = fronteira. Legenda decodifica NODE / EDGE / EVIDENCE. Takeaway: antes de virar ClienteService ou Address API, um grafo é só círculos conectados por relações com evidência.");
}

function buildSlide03(pres) {
  const slide = pres.addSlide();
  slide.background = { color: DESIGN.bg0 };
  addTitleBar(slide, "Exemplo MVC fictício — código real", "ClienteController -> ClienteService -> ClienteRepository + AddressClient -> Address API");
  addFooter(slide, 3);

  // === Panel 1: ClienteController.kt ===
  addCodeBlock(slide, 0.6, 1.45, 6.0, 2.4, "ClienteController.kt",
`@RestController
@RequestMapping("/clientes")
class ClienteController(
    private val service: ClienteService
) {
    @GetMapping("/{id}")
    fun buscar(
        @PathVariable id: Long
    ): ClienteDto =
        service.buscar(id).toDto()
}`);

  // === Panel 2: ClienteService.kt (has addressClient.get) ===
  addCodeBlock(slide, 6.8, 1.45, 6.0, 2.4, "ClienteService.kt",
`@Service
class ClienteService(
    private val repo: ClienteRepository,
    private val addressClient: AddressClient
) {
    fun buscar(id: Long): Cliente {
        val c = repo.findById(id)
            ?: throw NotFoundException(id)
        val addr = addressClient.get(c.cep)
        return c.copy(address = addr)
    }
}`);

  // === Panel 3: ClienteRepository.kt ===
  addCodeBlock(slide, 0.6, 3.95, 6.0, 2.6, "ClienteRepository.kt",
`package br.example.cliente

import org.springframework.data.jpa
    .repository.JpaRepository

interface ClienteRepository :
    JpaRepository<Cliente, Long> {

    // chamado por ClienteService.buscar
    fun findById(id: Long): Cliente?
}`);

  // === Panel 4: AddressClient.kt + application.yml (has address.api.url) ===
  addCodeBlock(slide, 6.8, 3.95, 6.0, 2.6, "AddressClient.kt + application.yml",
`@Component
class AddressClient(
    @Value("\\\${address.api.url}")
    private val baseUrl: String,
    private val rest: RestClient
) {
    fun get(cep: String): Address =
        rest.get()
            .uri("\\\${baseUrl}/addresses/\\\${cep}")
            .retrieve().body()!!
}

# application.yml
address:
  api:
    url: https://address.svc/v1`);

  // === Bottom caption: bridge to slide 4 ===
  slide.addText([
    { text: "Próximo slide: ", options: { bold: true, color: DESIGN.accent } },
    { text: "cada classe/method vira um node (kind + id canônico); cada chamada — addressClient.get, findById, http_call — vira uma edge com evidence file:line.", options: { color: DESIGN.text2 } },
  ], {
    x: 0.6, y: 6.65, w: 12.1, h: 0.35,
    fontFace: DESIGN.body, fontSize: 11, margin: 0,
  });

  slide.addNotes("Mesmo exemplo MVC fictício agora como código Kotlin/Spring real. ClienteController delega a ClienteService. Service chama ClienteRepository (JPA) e AddressClient (HTTP externo). AddressClient injeta address.api.url do application.yml via @Value. Os elementos visíveis que virarão graph: classes, métodos, a chamada addressClient.get(c.cep), o binding address.api.url -> https://address.svc/v1. Próximo slide mapeia isso em nodes/edges.");
}

function buildSlide04(pres) {
  const slide = pres.addSlide();
  slide.background = { color: DESIGN.bg0 };
  addTitleBar(slide, "Do código ao grafo", "classes viram nodes com kind + id canônico · chamadas viram edges com evidence file:line");
  addFooter(slide, 4);

  // === EDGES FIRST ===
  // Horizontal top row: Service -> AddressClient -> Address API
  slide.addShape("rightArrow", { x: 3.4, y: 2.05, w: 1.1, h: 0.25, fill: { color: DESIGN.observed } });   // Service -> AddressClient (calls)
  slide.addShape("rightArrow", { x: 7.3, y: 2.05, w: 1.1, h: 0.25, fill: { color: DESIGN.inferred } });    // AddressClient -> Address API (http_call)
  // Vertical: Service -> Repository (down)
  slide.addShape("downArrow", { x: 1.85, y: 2.65, w: 0.26, h: 0.95, fill: { color: DESIGN.observed } });
  // Vertical: config_binding -> Address API (up)
  slide.addShape("upArrow", { x: 9.65, y: 2.7, w: 0.26, h: 0.9, fill: { color: DESIGN.inferred } });

  // === EDGE LABELS + EVIDENCE ===
  // Horizontal: labels above arrows (in the gap between nodes)
  addEdgeLabel(slide, 3.4, 1.5, 1.1, "calls", "Service.kt:11", DESIGN.observed);
  addEdgeLabel(slide, 7.3, 1.5, 1.1, "http_call", "Client.kt:9", DESIGN.inferred);
  // Vertical: labels to the right of arrows (in the gap between rows)
  slide.addText("calls", { x: 2.2, y: 2.78, w: 1.0, h: 0.2, fontFace: DESIGN.mono, fontSize: 9, bold: true, color: DESIGN.observed, margin: 0 });
  slide.addText("Service.kt:13", { x: 2.2, y: 2.98, w: 1.1, h: 0.18, fontFace: DESIGN.mono, fontSize: 8, color: DESIGN.text3, margin: 0 });
  slide.addText("config_binding", { x: 10.0, y: 2.78, w: 1.2, h: 0.2, fontFace: DESIGN.mono, fontSize: 9, bold: true, color: DESIGN.inferred, margin: 0 });
  slide.addText("application.yml:5", { x: 10.0, y: 2.98, w: 1.3, h: 0.18, fontFace: DESIGN.mono, fontSize: 8, color: DESIGN.text3, margin: 0 });

  // === NODES (with kind chips + canonical ids + evidence) ===
  addGraphNode(slide, 0.6, 1.7, 2.8, 0.95, {
    kind: "method", kindColor: DESIGN.accent,
    name: "ClienteService.buscar",
    subtitle: "method:cliente:buscar",
    evidence: "ClienteService.kt:7",
  });
  addGraphNode(slide, 4.5, 1.7, 2.8, 0.95, {
    kind: "method", kindColor: DESIGN.accent,
    name: "AddressClient.get",
    subtitle: "method:address:get",
    evidence: "AddressClient.kt:8",
  });
  addGraphNode(slide, 8.4, 1.7, 2.8, 0.95, {
    kind: "http_inbound", kindColor: DESIGN.frontier,
    name: "Address API",
    subtitle: "http_inbound:/addresses/{cep}",
    evidence: "external endpoint",
    isFrontier: true,
  });
  addGraphNode(slide, 0.6, 3.6, 2.8, 0.95, {
    kind: "method", kindColor: DESIGN.accent,
    name: "ClienteRepository.findById",
    subtitle: "method:cliente:findById",
    evidence: "ClienteRepository.kt:10",
  });
  addGraphNode(slide, 8.4, 3.6, 2.8, 0.95, {
    kind: "config_binding", kindColor: DESIGN.inferred,
    name: "address.api.url",
    subtitle: "config_binding:address.api.url",
    evidence: "application.yml:5",
    isFrontier: true,
  });

  // === Bottom callout: FRONTIER -> L1 SystemEdge ===
  slide.addShape("roundedRectangle", {
    x: 0.6, y: 5.65, w: 12.1, h: 1.3,
    fill: { color: DESIGN.bg2 }, line: { color: DESIGN.frontier, width: 1.5 },
    rectRadius: 0.06,
  });
  // Badge
  slide.addShape("roundedRectangle", {
    x: 0.85, y: 5.85, w: 4.2, h: 0.42,
    fill: { color: DESIGN.frontier }, rectRadius: 0.05,
  });
  slide.addText("FRONTIER  ->  L1 SystemEdge", {
    x: 0.85, y: 5.85, w: 4.2, h: 0.42,
    fontFace: DESIGN.mono, fontSize: 11, bold: true,
    color: DESIGN.text, align: "center", valign: "middle", margin: 0,
  });
  // Explanation
  slide.addText("http_call e config_binding são FrontierFacts (ff:out, ff:cfg). O L1 stitch conecta ff:out deste repo ao ff:in do Address API — match por path_contract (score 0.55) ou config_binding (score 0.95). Resultado: SystemEdge cross-service l1:<hash32>.", {
    x: 5.3, y: 5.82, w: 7.2, h: 0.95,
    fontFace: DESIGN.body, fontSize: 11, color: DESIGN.text2, margin: 0,
  });

  slide.addNotes("Mapeamento do codigo do slide 3 em grafo. Cada classe/method vira um node com kind chip + id canonico + evidence file:line. ClienteService.buscar chama AddressClient.get (calls), que faz http_call para Address API (frontier). Service tambem chama ClienteRepository.findById (calls). O binding address.api.url (config_binding) aponta para o mesmo Address API. As duas arestas frontier (http_call, config_binding) sao FrontierFacts. No L1 stitch viram SystemEdge cross-service. Frontier -> L1 e o motivo de L1 existir.");
}

function buildSlide05(pres) {
  const slide = pres.addSlide();
  slide.background = { color: DESIGN.bg0 };
  addTitleBar(slide, "Short ID decoder (v2/proposto)", "IDs canônicos determinísticos — formato pretendido, não emitido hoje por completo");
  addFooter(slide, 5);

  const ids = [
    ["l0:method:*", "KnowledgeRecord de método/função (L0)"],
    ["l0:rel:*", "Relation entre dois records (L0)"],
    ["l0:ff:*", "FrontierFact (http_in/out, config) — L0→L1 boundary"],
    ["l1:edge:*", "SystemEdge cross-service (L1)"],
    ["l2:journey:*", "JourneySpec (L2)"],
    ["l2:bind:*", "Bind de JourneySpec a edges (L2)"],
    ["slice:*", "Context Slice (derivation_key → sha256)"],
    ["pack:*", "Context Pack (projeção orçada do Slice)"],
  ];

  addTable(slide, 0.6, 1.6, 12.1, 3.6, ["Formato", "Significado"], ids, [3.2, 8.9]);

  slide.addShape("roundedRectangle", {
    x: 0.6,
    y: 5.4,
    w: 12.1,
    h: 1.1,
    fill: { color: DESIGN.bg2 },
    line: { color: DESIGN.missing, width: 1.5 },
    rectRadius: 0.06,
  });
  slide.addText("⚠️ IMPORTANTE", {
    x: 0.8,
    y: 5.55,
    w: 11.7,
    h: 0.3,
    fontFace: DESIGN.body,
    fontSize: 12,
    bold: true,
    color: DESIGN.missing,
    margin: 0,
  });
  slide.addText("Este é o formato v2/proposto. O código atual emite ids canônicos `${type}:${natural_key}` e `ff:<kind>:<hash>:<line>`, `l1:<hash32>`. O padrão curto com prefixos l0:/l1:/l2:/slice:/pack: é a intenção de evolução, não a implementação atual.", {
    x: 0.8,
    y: 5.9,
    w: 11.7,
    h: 0.5,
    fontFace: DESIGN.body,
    fontSize: 11,
    color: DESIGN.text2,
    margin: 0,
  });

  slide.addNotes("Decoder dos IDs curtos propostos. l0:method:* e l0:rel:* são L0. l0:ff:* é frontier fact (L0→L1). l1:edge:* conecta dois frontier facts. l2:journey:* e l2:bind:* são L2. slice:* e pack:* são as unidades de cache e entrega. Este formato é v2/proposto — o código atual não emite todos os prefixos.");
}

function buildSlide06(pres) {
  const slide = pres.addSlide();
  slide.background = { color: DESIGN.bg0 };
  addTitleBar(slide, "L0 KnowledgeRecord", "todo record semântico persistido após Human Gate");
  addFooter(slide, 6);

  const attrs = [
    ["id", "string", "canonicalRecordId(type, natural_key) — ex.: method:cliente:findById"],
    ["namespace", "string", "Knowledge Namespace do projeto"],
    ["type", "string", "Discriminador semântico (method, class, http_inbound...)"],
    ["name", "string", "Nome legível (ex.: findById)"],
    ["summary", "string", "Resumo factual curto (≤512 chars)"],
    ["attributes", "object", "Mapa de scalars (snake_case ou dotted keys)"],
    ["status", "enum", "comprovado | hipótese | contradição | stale (inicial: hipótese)"],
    ["source_revision", "string", "Git SHA do commit indexado"],
    ["source_engine", "object", "{name, profile, adapter_version, artifact_manifest_id}"],
    ["evidence", "array", "[{kind:'artifact', file, line, snippet, revision}, ...]"],
  ];

  addTable(slide, 0.6, 1.5, 12.1, 4.0, ["Campo", "Tipo", "Descrição"], attrs, [2.4, 1.6, 8.1]);

  addCodeBlock(slide, 0.6, 5.6, 12.1, 1.0, "Exemplo (compactado)", `{"id":"method:cliente:findById","type":"method","natural_key":"cliente:findById","name":"findById","summary":"Busca cliente por id","attributes":{"visibility":"public"},"status":"hipótese","evidence":[{"kind":"artifact","file":"src/main/kotlin/.../ClienteRepository.kt","line":42,"snippet":"fun findById(id: Long)","revision":"a1b2c3d"}]}`);

  slide.addNotes("KnowledgeRecord é o átomo do L0. id é canônico (type:natural_key). type é o discriminador. status começa como hipótese (nunca confia em comprovado do Explorer). source_engine identifica Graphify+Explorer. evidence é array de artifact ou repository. O record é persistido só após Human Gate.");
}

function buildSlide07(pres) {
  const slide = pres.addSlide();
  slide.background = { color: DESIGN.bg0 };
  addTitleBar(slide, "L0 Relation + Evidence", "aresta semântica + prova factual");
  addFooter(slide, 7);

  const relAttrs = [
    ["id", "string", "canonicalRelationId(relation_type, from, to) — ex.: calls:method:a->method:b"],
    ["namespace", "string", "Mesmo namespace do records"],
    ["from_record", "string", "id canônico do record de origem"],
    ["relation_type", "string", "calls | implements | depends_on | http_call | ..."],
    ["to_record", "string", "id canônico do record de destino"],
    ["status", "enum", "comprovado | hipótese | contradição | stale"],
    ["source_revision", "string", "Git SHA"],
    ["source_engine", "object", "Mesmo shape do record"],
    ["evidence", "array", "Mesma estrutura do record (artifact | repository)"],
  ];

  addTable(slide, 0.6, 1.5, 12.1, 3.4, ["Campo", "Tipo", "Descrição"], relAttrs, [2.4, 1.6, 8.1]);

  slide.addText("Evidence é a prova. Sem evidence resolvida contra o manifest de artefatos, o record/relation é rejeitado no finalize. O Human Gate só vê o que passou por verificação estrutural.", {
    x: 0.6,
    y: 5.1,
    w: 12.1,
    h: 0.5,
    fontFace: DESIGN.body,
    fontSize: 12,
    color: DESIGN.text2,
    margin: 0,
  });

  addCodeBlock(slide, 0.6, 5.7, 12.1, 0.9, "Evidence (artifact)", `{"kind":"artifact","file":"src/main/kotlin/.../ClienteService.kt","line":87,"snippet":"val addr = addressClient.get(cep)","revision":"a1b2c3d","range":{"start":{"line":87,"col":12},"end":{"line":87,"col":45}}}`);

  slide.addNotes("Relation conecta dois records com relation_type e evidence. id é `${relation_type}:${from}->${to}`. Evidence é obrigatória e deve resolver contra o artifact manifest. Status segue o mesmo enum do record. O finalize só persiste o que passou por verificação de integridade de grafo (endpoints existem, ids únicos).");
}

function buildSlide08(pres) {
  const slide = pres.addSlide();
  slide.background = { color: DESIGN.bg0 };
  addTitleBar(slide, "L0 → SQLite", "candidate_packages + accepted_baselines");
  addFooter(slide, 8);

  // Two tables
  slide.addText("candidate_packages", {
    x: 0.6,
    y: 1.5,
    w: 6.0,
    h: 0.3,
    fontFace: DESIGN.body,
    fontSize: 12,
    bold: true,
    color: DESIGN.accent,
    margin: 0,
  });
  const candCols = [
    ["candidate_id", "TEXT PK"],
    ["namespace", "TEXT NOT NULL"],
    ["logical_repo", "TEXT NOT NULL"],
    ["source_revision", "TEXT NOT NULL"],
    ["canonical_graph_hash", "TEXT NOT NULL"],
    ["package_json", "TEXT NOT NULL"],
    ["created_at", "TEXT NOT NULL"],
    ["UNIQUE", "(ns, repo, rev, hash)"],
  ];
  addTable(slide, 0.6, 1.85, 6.0, 2.8, ["Coluna", "Tipo"], candCols, [2.8, 3.2]);

  slide.addText("accepted_baselines", {
    x: 6.9,
    y: 1.5,
    w: 6.0,
    h: 0.3,
    fontFace: DESIGN.body,
    fontSize: 12,
    bold: true,
    color: DESIGN.observed,
    margin: 0,
  });
  const accCols = [
    ["namespace", "TEXT PK"],
    ["logical_repo", "TEXT PK"],
    ["candidate_id", "TEXT FK → candidate_packages"],
    ["approver", "TEXT NOT NULL"],
    ["accepted_at", "TEXT NOT NULL"],
    ["PRIMARY KEY", "(ns, logical_repo)"],
  ];
  addTable(slide, 6.9, 1.85, 6.0, 2.2, ["Coluna", "Tipo"], accCols, [2.8, 3.2]);

  // Flow
  slide.addShape("roundedRectangle", { x: 0.6, y: 4.9, w: 2.8, h: 0.7, fill: { color: DESIGN.bg1 }, line: { color: DESIGN.accent, width: 1.5 }, rectRadius: 0.06 });
  slide.addText("prepare", { x: 0.6, y: 5.1, w: 2.8, h: 0.3, fontFace: DESIGN.body, fontSize: 12, bold: true, color: DESIGN.text, align: "center", margin: 0 });

  slide.addShape("rightArrow", { x: 3.5, y: 5.1, w: 0.6, h: 0.3, fill: { color: DESIGN.text3 } });

  slide.addShape("roundedRectangle", { x: 4.2, y: 4.9, w: 2.8, h: 0.7, fill: { color: DESIGN.bg1 }, line: { color: DESIGN.inferred, width: 1.5 }, rectRadius: 0.06 });
  slide.addText("finalize (candidate)", { x: 4.2, y: 5.1, w: 2.8, h: 0.3, fontFace: DESIGN.body, fontSize: 12, bold: true, color: DESIGN.text, align: "center", margin: 0 });

  slide.addShape("rightArrow", { x: 7.1, y: 5.1, w: 0.6, h: 0.3, fill: { color: DESIGN.text3 } });

  slide.addShape("roundedRectangle", { x: 7.8, y: 4.9, w: 2.8, h: 0.7, fill: { color: DESIGN.bg1 }, line: { color: DESIGN.missing, width: 1.5 }, rectRadius: 0.06 });
  slide.addText("Human Gate", { x: 7.8, y: 5.1, w: 2.8, h: 0.3, fontFace: DESIGN.body, fontSize: 12, bold: true, color: DESIGN.text, align: "center", margin: 0 });

  slide.addShape("rightArrow", { x: 10.7, y: 5.1, w: 0.6, h: 0.3, fill: { color: DESIGN.text3 } });

  slide.addShape("roundedRectangle", { x: 11.4, y: 4.9, w: 1.5, h: 0.7, fill: { color: DESIGN.accent }, line: { color: DESIGN.accent, width: 1.5 }, rectRadius: 0.06 });
  slide.addText("accept", { x: 11.4, y: 5.1, w: 1.5, h: 0.3, fontFace: DESIGN.body, fontSize: 12, bold: true, color: DESIGN.text, align: "center", margin: 0 });

  slide.addNotes("L0 persiste em duas tabelas. candidate_packages armazena o pacote completo (package_json) com hash do grafo. accepted_baselines marca o baseline aceito por approver humano (nunca auto-accept). O fluxo é prepare → finalize (gera candidate) → Human Gate → accept (insere em accepted_baselines). UNIQUE em (namespace, logical_repo, source_revision, canonical_graph_hash) garante determinismo.");
}

function buildSlide09(pres) {
  const slide = pres.addSlide();
  slide.background = { color: DESIGN.bg0 };
  addTitleBar(slide, "Por que L1 aponta para l0:ff:*, não l0:method:*", "A distinção central da arquitetura");
  addFooter(slide, 9);

  // Two columns
  slide.addShape("roundedRectangle", {
    x: 0.6,
    y: 1.5,
    w: 5.8,
    h: 2.8,
    fill: { color: DESIGN.bg1 },
    line: { color: DESIGN.accent, width: 2 },
    rectRadius: 0.08,
  });
  slide.addText("L0 KnowledgeRecord", {
    x: 0.8,
    y: 1.65,
    w: 5.4,
    h: 0.35,
    fontFace: DESIGN.body,
    fontSize: 14,
    bold: true,
    color: DESIGN.accent,
    margin: 0,
  });
  slide.addText("• method:cliente:findById\n• class:cliente:ClienteService\n• module:cliente:domain\n• http_inbound:/clientes/{id}\n\nSão fatos intra-repo, indexados por Graphify+Explorer.\n\nL1 NÃO deve apontar diretamente para eles.", {
    x: 0.8,
    y: 2.1,
    w: 5.4,
    h: 2.0,
    fontFace: DESIGN.body,
    fontSize: 12,
    color: DESIGN.text2,
    margin: 0,
  });

  slide.addShape("roundedRectangle", {
    x: 6.9,
    y: 1.5,
    w: 5.8,
    h: 2.8,
    fill: { color: DESIGN.bg1 },
    line: { color: DESIGN.frontier, width: 2, dashType: "dash" },
    rectRadius: 0.08,
  });
  slide.addText("L0 FrontierFact (l0:ff:*)", {
    x: 7.1,
    y: 1.65,
    w: 5.4,
    h: 0.35,
    fontFace: DESIGN.body,
    fontSize: 14,
    bold: true,
    color: DESIGN.frontier,
    margin: 0,
  });
  slide.addText("• ff:in:... (http_inbound)\n• ff:out:... (http_outbound)\n• ff:cfg:... (config_binding)\n\nSão fatos de fronteira — endpoints e chamadas cross-service.\n\nL1 conecta ff:out de um repo a ff:in de outro.", {
    x: 7.1,
    y: 2.1,
    w: 5.4,
    h: 2.0,
    fontFace: DESIGN.body,
    fontSize: 12,
    color: DESIGN.text2,
    margin: 0,
  });

  // Bottom explanation
  slide.addShape("roundedRectangle", {
    x: 0.6,
    y: 4.5,
    w: 12.1,
    h: 2.0,
    fill: { color: DESIGN.bg2 },
    line: { color: DESIGN.missing, width: 1.5 },
    rectRadius: 0.06,
  });
  slide.addText("Regra arquitetural (Locked Decision)", {
    x: 0.8,
    y: 4.65,
    w: 11.7,
    h: 0.3,
    fontFace: DESIGN.body,
    fontSize: 13,
    bold: true,
    color: DESIGN.missing,
    margin: 0,
  });
  slide.addText("L1 é cross-repo only. Se L1 apontasse para method:* (intra-repo), o grafo L1 conteria arestas que não são cross-service. O frontier fact (ff:*) é o contrato estável entre repositórios. O L1 stitch só considera http_outbound + http_inbound + config_binding. method:* e class:* são detalhes de implementação de um único repo — não atravessam fronteiras.", {
    x: 0.8,
    y: 5.05,
    w: 11.7,
    h: 1.3,
    fontFace: DESIGN.body,
    fontSize: 12,
    color: DESIGN.text2,
    margin: 0,
  });

  slide.addNotes("A distinção central: L0 method:* é intra-repo. L0 ff:* é frontier (http_in/out, config). L1 só conecta frontier facts cross-service. Se L1 apontasse para method:*, o grafo L1 conteria arestas intra-repo, violando o escopo de L1. O frontier fact é o contrato estável entre sistemas.");
}

function buildSlide10(pres) {
  const slide = pres.addSlide();
  slide.background = { color: DESIGN.bg0 };
  addTitleBar(slide, "L1 SystemEdge", "aresta cross-service + system_edges SQLite");
  addFooter(slide, 10);

  const edgeAttrs = [
    ["edge_id", "string", "l1:<hash32> — sha256 de (from + to + contract_key + match_kind)"],
    ["from", "object", "{namespace, logical_repo, fact_id} — fact_id é ff:*"],
    ["to", "object", "{namespace, logical_repo, fact_id} — fact_id é ff:*"],
    ["contract_key", "string", "GET:/clientes/{id} — normalizado"],
    ["method", "string", "GET | POST | PUT | DELETE | PATCH"],
    ["path", "string", "path HTTP normalizado"],
    ["evidence_class", "string", "\"contract-matched\" (sempre)"],
    ["match_kind", "enum", "config_binding | path_contract"],
    ["score", "real", "0.55 (path) a 0.95 (config_binding)"],
    ["config_key", "string?", "ex.: PROVIDERCONTROLLER_API_URL"],
    ["evidence", "array", "[{side:'from'|'to', file, line, snippet, revision}, ...]"],
  ];

  addTable(slide, 0.6, 1.5, 12.1, 3.6, ["Campo", "Tipo", "Descrição"], edgeAttrs, [2.2, 1.8, 8.1]);

  slide.addText("system_edges (SQLite L1)", {
    x: 0.6,
    y: 5.3,
    w: 12.1,
    h: 0.25,
    fontFace: DESIGN.body,
    fontSize: 11,
    bold: true,
    color: DESIGN.accent,
    margin: 0,
  });
  slide.addText("edge_id PK, system_namespace, from_*/to_*, contract_key, method, path, evidence_class, match_kind, score, config_key, edge_json, created_at. Índices por system_namespace, from/to_logical_repo, contract_key.", {
    x: 0.6,
    y: 5.6,
    w: 12.1,
    h: 0.6,
    fontFace: DESIGN.body,
    fontSize: 11,
    color: DESIGN.text2,
    margin: 0,
  });

  slide.addNotes("SystemEdge é a aresta L1. Conecta dois frontier facts (ff:*) de repositórios diferentes. match_kind = config_binding (score 0.95) ou path_contract (score 0.55). evidence_class é sempre contract-matched. A tabela system_edges armazena edge_json completo + metadados. system_stitch_runs registra cada execução do stitch.");
}

function buildSlide11(pres) {
  const slide = pres.addSlide();
  slide.background = { color: DESIGN.bg0 };
  addTitleBar(slide, "L2 JourneySpec + Bind", "jornada de negócio + bind a edges");
  addFooter(slide, 11);

  const journeyAttrs = [
    ["id", "string", "journey_id (ex.: buscar-cliente)"],
    ["system_namespace", "string", "Namespace do sistema"],
    ["members", "array", "logical_repos que participam da jornada"],
    ["steps", "array", "[{id, title, trigger, from, to, contract_prefix, description, provenance}]"],
    ["description", "string?", "Descrição legível da jornada"],
  ];

  addTable(slide, 0.6, 1.5, 6.0, 2.0, ["Campo (Spec)", "Tipo", "Descrição"], journeyAttrs, [2.0, 1.4, 2.6]);

  const bindAttrs = [
    ["journey_id", "string", "id da spec"],
    ["journey_hash", "string", "sha256(32) do bind material"],
    ["bind_id", "string", "${ns}:${journey_id}:${journey_hash}"],
    ["steps_bound", "int", "quantos steps tiveram edges"],
    ["steps_gap", "int", "quantos steps ficaram sem edge"],
    ["status", "enum", "complete | partial"],
    ["bound[]", "array", "step_id, status, edge_ids[]"],
    ["gaps[]", "array", "step_id, reason"],
  ];

  addTable(slide, 6.9, 1.5, 6.0, 2.8, ["Campo (Bind)", "Tipo", "Descrição"], bindAttrs, [2.0, 1.4, 2.6]);

  slide.addText("journey_specs (spec_revision PK), journey_binds (bind_id PK), journey_step_edges (bind_id+step_id+edge_id), journey_current (ns+journey_id → bind_id). O bind é determinístico: mesma spec + mesmos edges = mesmo journey_hash.", {
    x: 0.6,
    y: 4.5,
    w: 12.1,
    h: 0.7,
    fontFace: DESIGN.body,
    fontSize: 11,
    color: DESIGN.text2,
    margin: 0,
  });

  slide.addShape("roundedRectangle", {
    x: 0.6,
    y: 5.4,
    w: 12.1,
    h: 1.1,
    fill: { color: DESIGN.bg2 },
    line: { color: DESIGN.inferred, width: 1 },
    rectRadius: 0.06,
  });
  slide.addText("L2 não inventa narrativa de domínio. O propose-from-l1 agrupa edges por contract_prefix ou edge e gera steps com provenance (edge_ids, match_kinds, evidence). O bind só marca bound/gap — não preenche buracos com suposições.", {
    x: 0.8,
    y: 5.55,
    w: 11.7,
    h: 0.85,
    fontFace: DESIGN.body,
    fontSize: 11,
    color: DESIGN.text2,
    margin: 0,
  });

  slide.addNotes("JourneySpec é a jornada de negócio (id, members, steps). Bind conecta steps a L1 edges (bound) ou marca gaps. journey_hash é sha256 do material do bind. bind_id = ns:journey_id:journey_hash. O L2 não inventa narrativa — só marca o que foi encontrado vs. o que falta.");
}

function buildSlide12(pres) {
  const slide = pres.addSlide();
  slide.background = { color: DESIGN.bg0 };
  addTitleBar(slide, "Context Slice", "derivation_key → sha256 → slice:<hash>");
  addFooter(slide, 12);

  // Derivation key box
  slide.addShape("roundedRectangle", {
    x: 0.6,
    y: 1.5,
    w: 4.0,
    h: 3.8,
    fill: { color: DESIGN.bg1 },
    line: { color: DESIGN.accent, width: 2 },
    rectRadius: 0.08,
  });
  slide.addText("Derivation Key (6 campos)", {
    x: 0.8,
    y: 1.65,
    w: 3.6,
    h: 0.3,
    fontFace: DESIGN.body,
    fontSize: 12,
    bold: true,
    color: DESIGN.accent,
    margin: 0,
  });
  slide.addText("1. engine/schema version\n2. policy (name, version, options_hash)\n3. seeds (normalizados)\n4. L0 baseline hashes\n5. L1 edge_set_hash\n6. L2 bindings (journey_hash)\n\nQualquer mudança → nova chave → novo slice.", {
    x: 0.8,
    y: 2.05,
    w: 3.6,
    h: 3.0,
    fontFace: DESIGN.body,
    fontSize: 11,
    color: DESIGN.text2,
    margin: 0,
  });

  // Arrow
  slide.addShape("rightArrow", { x: 4.8, y: 3.2, w: 0.8, h: 0.4, fill: { color: DESIGN.text3 } });

  // sha256 box
  slide.addShape("roundedRectangle", {
    x: 5.8,
    y: 2.8,
    w: 2.2,
    h: 1.2,
    fill: { color: DESIGN.bg1 },
    line: { color: DESIGN.inferred, width: 2 },
    rectRadius: 0.08,
  });
  slide.addText("sha256", {
    x: 5.8,
    y: 3.0,
    w: 2.2,
    h: 0.3,
    fontFace: DESIGN.mono,
    fontSize: 14,
    bold: true,
    color: DESIGN.inferred,
    align: "center",
    margin: 0,
  });
  slide.addText("determinístico", {
    x: 5.8,
    y: 3.35,
    w: 2.2,
    h: 0.3,
    fontFace: DESIGN.body,
    fontSize: 10,
    color: DESIGN.text3,
    align: "center",
    margin: 0,
  });

  // Arrow
  slide.addShape("rightArrow", { x: 8.2, y: 3.2, w: 0.8, h: 0.4, fill: { color: DESIGN.text3 } });

  // slice_id box
  slide.addShape("roundedRectangle", {
    x: 9.2,
    y: 2.8,
    w: 3.5,
    h: 1.2,
    fill: { color: DESIGN.accent },
    line: { color: DESIGN.accent, width: 2 },
    rectRadius: 0.08,
  });
  slide.addText("slice:<hash64>", {
    x: 9.2,
    y: 3.0,
    w: 3.5,
    h: 0.3,
    fontFace: DESIGN.mono,
    fontSize: 14,
    bold: true,
    color: DESIGN.text,
    align: "center",
    margin: 0,
  });
  slide.addText("slice_id (PK)", {
    x: 9.2,
    y: 3.35,
    w: 3.5,
    h: 0.3,
    fontFace: DESIGN.body,
    fontSize: 10,
    color: DESIGN.text,
    align: "center",
    margin: 0,
  });

  // Key points
  slide.addText("slice_hash = sha256(canonical_payload) — audit envelope NÃO participa do hash.\nderivation_key = sha256(full derivation struct) — seeds, policy, L0/L1/L2 hashes, engine versions.", {
    x: 0.6,
    y: 5.5,
    w: 12.1,
    h: 0.6,
    fontFace: DESIGN.body,
    fontSize: 11,
    color: DESIGN.text2,
    margin: 0,
  });

  slide.addNotes("Context Slice é a unidade determinística de contexto. derivation_key é sha256 de 6 campos (engine, policy, seeds, L0 hashes, L1 edge_set_hash, L2 bindings). slice_hash é sha256 do canonical payload (audit excluído). slice_id = slice:<hash>. Qualquer mudança na chave → novo slice. É content-addressed cache.");
}

function buildSlide13(pres) {
  const slide = pres.addSlide();
  slide.background = { color: DESIGN.bg0 };
  addTitleBar(slide, "Context Slice → SQLite", "context_slices + child tables + current + schema_versions");
  addFooter(slide, 13);

  const sliceCols = [
    ["slice_id", "TEXT PK — slice:<hash>"],
    ["derivation_key", "TEXT UNIQUE NOT NULL"],
    ["slice_hash", "TEXT NOT NULL"],
    ["canonical_payload_json", "TEXT NOT NULL"],
    ["policy_name", "TEXT NOT NULL"],
    ["policy_version", "INTEGER NOT NULL"],
    ["status", "TEXT CHECK(cache_hit|materialized)"],
    ["system_namespace", "TEXT NOT NULL"],
    ["seed_set_hash", "TEXT NOT NULL"],
    ["created_at / updated_at", "TEXT NOT NULL"],
    ["materialization_ms", "INTEGER DEFAULT 0"],
  ];

  addTable(slide, 0.6, 1.5, 6.0, 3.4, ["Coluna (context_slices)", "Tipo"], sliceCols, [2.6, 3.4]);

  const childCols = [
    ["context_slice_seeds", "slice_id+seq PK, seed_json, FK CASCADE"],
    ["context_slice_nodes", "slice_id+seq PK, node_json, FK CASCADE"],
    ["context_slice_edges", "slice_id+seq PK, edge_json, FK CASCADE"],
    ["context_slice_misses", "slice_id+seq PK, miss_json, FK CASCADE"],
    ["context_slice_current", "ns+policy+seed_set_hash PK → slice_id, FK CASCADE"],
    ["explorer_schema_versions", "component PK, version, applied_at (shared)"],
  ];

  addTable(slide, 6.9, 1.5, 6.0, 2.4, ["Tabela filha", "Chave"], childCols, [2.8, 3.2]);

  slide.addText("Migração forward-only. Versão do schema é por component (context-slice), não PRAGMA user_version. DDL V1 é aplicado em BEGIN IMMEDIATE; falha → ROLLBACK. current é upsert por (ns, policy, seed_set_hash).", {
    x: 0.6,
    y: 5.1,
    w: 12.1,
    h: 0.7,
    fontFace: DESIGN.body,
    fontSize: 11,
    color: DESIGN.text2,
    margin: 0,
  });

  slide.addNotes("context_slices é a raiz. derivation_key UNIQUE garante que mesma chave = mesmo slice. child tables são FK ON DELETE CASCADE. context_slice_current é o ponteiro para o slice atual por (ns, policy, seed_set_hash). explorer_schema_versions é shared (L1/L2/Slice) e component-scoped. Migração é forward-only e transacional.");
}

function buildSlide14(pres) {
  const slide = pres.addSlide();
  slide.background = { color: DESIGN.bg0 };
  addTitleBar(slide, "Context Pack", "projeção orçada do Slice — o que o agente/humano recebe");
  addFooter(slide, 14);

  const packAttrs = [
    ["pack_id", "string", "pack:<hash64> — sha256 do canonical Pack payload"],
    ["slice_hash", "string", "hash do Slice de origem"],
    ["derivation_summary", "object", "{derivation_key, engine_version, slice_schema_version, system_namespace, policy}"],
    ["seeds", "array", "seeds do Slice (sempre presente, minItems:1)"],
    ["budget", "object", "{requested, used} — used <= requested (invariante)"],
    ["coverage_summary", "object", "{nodes, edges, misses}"],
    ["truncated", "bool", "true se bateu budget e descartou conteúdo"],
  ];

  addTable(slide, 0.6, 1.5, 12.1, 2.8, ["Campo", "Tipo", "Descrição"], packAttrs, [2.4, 1.6, 8.1]);

  slide.addShape("roundedRectangle", {
    x: 0.6,
    y: 4.5,
    w: 12.1,
    h: 2.0,
    fill: { color: DESIGN.bg2 },
    line: { color: DESIGN.observed, width: 1.5 },
    rectRadius: 0.06,
  });
  slide.addText("Regra de orçamento (Locked Decision #6)", {
    x: 0.8,
    y: 4.65,
    w: 11.7,
    h: 0.3,
    fontFace: DESIGN.body,
    fontSize: 12,
    bold: true,
    color: DESIGN.observed,
    margin: 0,
  });
  slide.addText("O Slice é completo (todo o grafo indexado). O Pack é a projeção orçada — só o que cabe no budget do agente. Token/node/edge budgets aplicam AQUI, nunca no Slice. O Pack carrega evidence e pointers para o código original. É o que o agente/humano realmente consome.", {
    x: 0.8,
    y: 5.05,
    w: 11.7,
    h: 1.3,
    fontFace: DESIGN.body,
    fontSize: 12,
    color: DESIGN.text2,
    margin: 0,
  });

  slide.addNotes("Context Pack é a projeção orçada do Slice. pack_id = pack:<hash>. derivation_summary é suficiente para reproduzir o Slice. seeds é sempre presente. budget {requested, used} com used <= requested. truncated indica se bateu limite. O Slice é completo; o Pack é o que cabe no orçamento do agente. É o artefato final de entrega.");
}

function buildSlide15(pres) {
  const slide = pres.addSlide();
  slide.background = { color: DESIGN.bg0 };

  slide.addText("Recap: build up / query down", {
    x: 0.6,
    y: 0.4,
    w: 12.1,
    h: 0.6,
    fontFace: DESIGN.title,
    fontSize: 28,
    bold: true,
    color: DESIGN.text,
    margin: 0,
  });

  // Build up column
  slide.addShape("roundedRectangle", {
    x: 0.6,
    y: 1.2,
    w: 5.8,
    h: 4.8,
    fill: { color: DESIGN.bg1 },
    line: { color: DESIGN.accent, width: 2 },
    rectRadius: 0.08,
  });
  slide.addText("BUILD UP (indexação)", {
    x: 0.8,
    y: 1.35,
    w: 5.4,
    h: 0.35,
    fontFace: DESIGN.body,
    fontSize: 14,
    bold: true,
    color: DESIGN.accent,
    margin: 0,
  });
  slide.addText("1. Graphify (AST → nodes/edges estruturais)\n2. Explorer (semântica + evidence)\n3. Finalize + Human Gate (aceite explícito)\n4. L0 persist (candidate → accepted)\n5. L1 stitch (frontier facts → system_edges)\n6. L2 bind (JourneySpec → journey_binds)\n7. Slice materialize (derivation_key → slice)\n8. Pack (orçamento + projeção)", {
    x: 0.8,
    y: 1.8,
    w: 5.4,
    h: 3.8,
    fontFace: DESIGN.body,
    fontSize: 12,
    color: DESIGN.text2,
    margin: 0,
  });

  // Query down column
  slide.addShape("roundedRectangle", {
    x: 6.9,
    y: 1.2,
    w: 5.8,
    h: 4.8,
    fill: { color: DESIGN.bg1 },
    line: { color: DESIGN.observed, width: 2 },
    rectRadius: 0.08,
  });
  slide.addText("QUERY DOWN (entrega)", {
    x: 7.1,
    y: 1.35,
    w: 5.4,
    h: 0.35,
    fontFace: DESIGN.body,
    fontSize: 14,
    bold: true,
    color: DESIGN.observed,
    margin: 0,
  });
  slide.addText("1. seed/policy → derivation_key\n2. lookup context_slice_current\n3. HIT → reuse slice\n4. MISS → materialize L0+L1+L2\n5. persist novo slice + current\n6. aplicar budget → Pack\n7. entregar pack_id + evidence + pointers\n8. agente/humano consome contexto verificável", {
    x: 7.1,
    y: 1.8,
    w: 5.4,
    h: 3.8,
    fontFace: DESIGN.body,
    fontSize: 12,
    color: DESIGN.text2,
    margin: 0,
  });

  slide.addText("O grafo é fonte de verdade. O Slice é a unidade de cache determinística. O Pack é a projeção orçada para consumo.", {
    x: 0.6,
    y: 6.2,
    w: 12.1,
    h: 0.4,
    fontFace: DESIGN.body,
    fontSize: 13,
    color: DESIGN.text2,
    margin: 0,
  });

  slide.addNotes("Recap do pipeline. Build up: Graphify → Explorer → Human Gate → L0 → L1 → L2 → Slice → Pack. Query down: derivation_key → current → HIT/MISS → materialize → Pack → entrega. O grafo é fonte de verdade. O Slice é cache determinístico. O Pack é o que o agente consome. Nada é inferido sem evidence.");
}

// === CURRENT-MODEL NARRATIVE (slides 4-15) ===
function addNarrativeCircle(slide, x, y, label, detail, color, frontier = false) {
  slide.addShape("ellipse", {
    x, y, w: 1.45, h: 1.45,
    fill: { color: DESIGN.bg1 },
    line: { color, width: 2, dashType: frontier ? "dash" : "solid" },
  });
  slide.addText(label, {
    x: x + 0.12, y: y + 0.4, w: 1.21, h: 0.42,
    fontFace: DESIGN.body, fontSize: 10, bold: true,
    color: DESIGN.text, align: "center", margin: 0,
  });
  slide.addText(detail, {
    x: x - 0.15, y: y + 1.5, w: 1.75, h: 0.36,
    fontFace: DESIGN.mono, fontSize: 7.5,
    color, align: "center", margin: 0,
  });
}

function addNarrativeEdge(slide, x, y, w, h, label, evidence, color, dashed = false) {
  slide.addShape("line", {
    x, y, w, h,
    line: { color, width: 2, dashType: dashed ? "dash" : "solid", endArrowType: "triangle" },
  });
  slide.addText(label, {
    x: x + (w >= 0 ? 0 : w), y: y - 0.34,
    w: Math.max(Math.abs(w), 1.15), h: 0.2,
    fontFace: DESIGN.mono, fontSize: 8.5, bold: true,
    color, align: "center", margin: 0,
  });
  slide.addText(evidence, {
    x: x + (w >= 0 ? 0 : w), y: y - 0.14,
    w: Math.max(Math.abs(w), 1.15), h: 0.18,
    fontFace: DESIGN.mono, fontSize: 7.2,
    color: DESIGN.text3, align: "center", margin: 0,
  });
}

function buildCurrentSlide04(pres) {
  const slide = pres.addSlide();
  slide.background = { color: DESIGN.bg0 };
  addTitleBar(slide, "Este código vira este grafo", "o mesmo desenho do slide anterior, agora com símbolos reais do código");
  addFooter(slide, 4);

  addNarrativeEdge(slide, 2.05, 2.25, 0.95, 0, "calls", "Controller.kt:9", DESIGN.observed);
  addNarrativeEdge(slide, 4.45, 2.25, 0.95, 0, "calls", "Service.kt:10", DESIGN.observed);
  addNarrativeEdge(slide, 6.85, 2.25, 0.95, 0, "http_call", "Client.kt:9", DESIGN.inferred, true);
  addNarrativeEdge(slide, 3.72, 2.92, 1.2, 1.25, "calls", "Service.kt:8", DESIGN.observed);
  addNarrativeEdge(slide, 8.52, 4.2, 0, -1.3, "config_binding", "application.yml:5", DESIGN.inferred, true);

  addNarrativeCircle(slide, 0.6, 1.55, "Controller.buscar", "ClienteController.kt:7", DESIGN.accent);
  addNarrativeCircle(slide, 3.0, 1.55, "Service.buscar", "ClienteService.kt:7", DESIGN.accent);
  addNarrativeCircle(slide, 5.4, 1.55, "AddressClient.get", "AddressClient.kt:7", DESIGN.accent);
  addNarrativeCircle(slide, 7.8, 1.55, "Address API", "GET /addresses/{cep}", DESIGN.frontier, true);
  addNarrativeCircle(slide, 4.65, 4.05, "Repository.findById", "Repository.kt:8", DESIGN.accent);
  addNarrativeCircle(slide, 7.8, 4.05, "address.api.url", "application.yml:5", DESIGN.inferred, true);

  addCard(slide, 10.0, 1.55, 2.7, 1.2, "SÍMBOLO → NODE", ["fun buscar", "class AddressClient", "endpoint/config"], DESIGN.accent);
  addCard(slide, 10.0, 3.05, 2.7, 1.2, "CHAMADA → EDGE", ["service.buscar(id)", "repo.findById(id)", "rest.get()"], DESIGN.observed);
  addCard(slide, 10.0, 4.55, 2.7, 1.2, "FILE:LINE → EVIDENCE", ["prova de onde nasceu", "cada node e cada edge", "voltam ao código"], DESIGN.inferred);
  slide.addNotes("O código do slide anterior vira o mesmo grafo genérico de círculos. Símbolos viram nodes, chamadas viram edges e arquivo/linha vira evidence. O desenho mantém o mesmo modelo mental antes de introduzir L0.");
}

function buildCurrentSlide05(pres) {
  const slide = pres.addSlide();
  slide.background = { color: DESIGN.bg0 };
  addTitleBar(slide, "O grafo vira objetos L0", "cada elemento visual recebe uma representação canônica e verificável");
  addFooter(slide, 5);

  addNarrativeCircle(slide, 0.8, 1.65, "Service.buscar", "node do grafo", DESIGN.accent);
  slide.addShape("rightArrow", { x: 2.55, y: 2.1, w: 0.8, h: 0.35, fill: { color: DESIGN.text3 } });
  addCard(slide, 3.55, 1.55, 3.1, 1.65, "KnowledgeRecord", ["id + type + natural_key", "name + summary + attributes", "status + evidence + node_keys"], DESIGN.accent);

  slide.addShape("line", { x: 0.8, y: 4.25, w: 1.45, h: 0, line: { color: DESIGN.observed, width: 2, endArrowType: "triangle" } });
  slide.addText("calls", { x: 0.8, y: 3.9, w: 1.45, h: 0.2, fontFace: DESIGN.mono, fontSize: 9, color: DESIGN.observed, align: "center", margin: 0 });
  slide.addShape("rightArrow", { x: 2.55, y: 4.08, w: 0.8, h: 0.35, fill: { color: DESIGN.text3 } });
  addCard(slide, 3.55, 3.55, 3.1, 1.65, "Relation", ["from_record + to_record", "relation_type = calls", "status + evidence"], DESIGN.observed);

  slide.addShape("roundedRectangle", { x: 0.8, y: 5.8, w: 1.45, h: 0.46, fill: { color: DESIGN.bg1 }, line: { color: DESIGN.inferred, width: 1 }, rectRadius: 0.04 });
  slide.addText("Service.kt:10", { x: 0.8, y: 5.92, w: 1.45, h: 0.2, fontFace: DESIGN.mono, fontSize: 8, color: DESIGN.inferred, align: "center", margin: 0 });
  slide.addShape("rightArrow", { x: 2.55, y: 5.86, w: 0.8, h: 0.35, fill: { color: DESIGN.text3 } });
  addCard(slide, 3.55, 5.45, 3.1, 1.15, "Evidence", ["artifact + repository", "manifest/hash/range ou repo URI"], DESIGN.inferred);

  addCard(slide, 7.1, 1.55, 5.6, 2.1, "COMPONENTES DERIVADOS DO CÓDIGO", ["classes e métodos → records internos", "módulos e serviços → estrutura semântica", "endpoints e configurações → records de fronteira", "relações → calls, depends_on, implements, http_call"], DESIGN.accent);
  addCard(slide, 7.1, 4.05, 5.6, 2.1, "REGRA DO L0", ["Graphify fornece estrutura", "Explorer adiciona semântica limitada", "Finalize reconstrói ids/evidence e verifica integridade", "Human Gate aceita o candidate; nada é auto-aceito"], DESIGN.observed);
  slide.addNotes("Node, edge e file:line deixam de ser apenas desenho: viram KnowledgeRecord, Relation e Evidence. L0 também deriva componentes semânticos do código, mas ainda estamos dentro de um único repositório.");
}

function buildCurrentSlide06(pres) {
  const slide = pres.addSlide();
  slide.background = { color: DESIGN.bg0 };
  addTitleBar(slide, "L0 KnowledgeRecord — de onde vem cada campo", "exemplo: ClienteService.buscar");
  addFooter(slide, 6);
  addCodeBlock(slide, 0.6, 1.45, 4.3, 4.8, "ClienteService.kt", `@Service\nclass ClienteService(\n  private val repo: ClienteRepository,\n  private val addressClient: AddressClient\n) {\n  fun buscar(id: Long): Cliente {\n    val c = repo.findById(id)\n      ?: throw NotFoundException(id)\n    val addr = addressClient.get(c.cep)\n    return c.copy(address = addr)\n  }\n}`);
  addTable(slide, 5.2, 1.45, 7.5, 4.85,
    ["Campo atual", "Valor / origem"],
    [
      ["id", "l0:method:cliente-service:ClienteService.buscar"],
      ["type / natural_key", "method / cliente-service:ClienteService.buscar"],
      ["name", "ClienteService.buscar — símbolo do código"],
      ["summary", "Resumo factual limitado produzido pelo Explorer"],
      ["attributes", "Scalars limitados: visibility, source_file, line..."],
      ["status", "hipótese no finalize; Human Gate decide baseline"],
      ["evidence[]", "artifact + repository, reconstruídos do key_map"],
      ["node_keys[]", "chaves opacas do Graphify preservadas"],
    ], [2.4, 5.1]);
  slide.addText("namespace, logical_repo, source_revision, source engine e artifact_manifest pertencem ao pacote canônico; não são duplicados em cada record.", { x: 5.2, y: 6.45, w: 7.5, h: 0.42, fontFace: DESIGN.body, fontSize: 10.5, color: DESIGN.text2, margin: 0 });
  slide.addNotes("O record atual guarda apenas seus campos semânticos e evidence. Metadados de repo e revisão ficam no package_json. O id é l0:type:natural_key e é determinístico.");
}

function buildCurrentSlide07(pres) {
  const slide = pres.addSlide();
  slide.background = { color: DESIGN.bg0 };
  addTitleBar(slide, "L0 Relation e Evidence — de onde vem cada campo", "Service.buscar --calls--> Repository.findById");
  addFooter(slide, 7);
  addNarrativeCircle(slide, 0.75, 1.65, "Service.buscar", "l0:method:...buscar", DESIGN.accent);
  addNarrativeEdge(slide, 2.35, 2.35, 1.55, 0, "calls", "ClienteService.kt:8", DESIGN.observed);
  addNarrativeCircle(slide, 4.0, 1.65, "Repository.findById", "l0:method:...findById", DESIGN.accent);
  addTable(slide, 0.6, 3.75, 6.1, 2.55, ["Relation", "Valor atual"], [
    ["id", "l0:rel:calls:<from-natural-key>-><to-natural-key>"],
    ["relation_type", "calls"],
    ["from_type / from_natural_key", "method / ClienteService.buscar"],
    ["to_type / to_natural_key", "method / ClienteRepository.findById"],
    ["from_record / to_record", "ids L0 completos dos dois records"],
    ["status / evidence[]", "hipótese + provas reconstruídas"],
  ], [2.3, 3.8]);
  addTable(slide, 7.0, 1.45, 5.7, 4.85, ["Evidence", "O que prova"], [
    ["kind=artifact", "manifest_id + artifact_path"],
    ["content_sha256", "conteúdo exato do artefato preparado"],
    ["range", "start_line / end_line do símbolo ou chamada"],
    ["kind=repository", "repo://repo@revision/file#Lx-Ly"],
    ["node_keys", "liga o payload semântico ao Graphify key_map"],
  ], [2.2, 3.5]);
  slide.addText("Sem evidence resolvida contra o artifact manifest, o finalize rejeita record/relation antes de persistir o candidate.", { x: 7.0, y: 6.45, w: 5.7, h: 0.45, fontFace: DESIGN.body, fontSize: 10.5, color: DESIGN.inferred, margin: 0 });
  slide.addNotes("A Relation usa ids completos dos records como endpoints. Evidence não é texto decorativo: resolve contra o manifest, hash e range preparado. Falha de evidence bloqueia persistência.");
}

function buildCurrentSlide08(pres) {
  const slide = pres.addSlide();
  slide.background = { color: DESIGN.bg0 };
  addTitleBar(slide, "FrontierFacts — o que o L0 deriva para sua fronteira", "uma projeção determinística dos records que atravessam o repositório");
  addFooter(slide, 8);
  addCard(slide, 0.6, 1.45, 3.65, 2.15, "RECORDS INTERNOS", ["method", "class / service", "module", "permanecem no grafo intra-repo"], DESIGN.accent);
  addCard(slide, 4.55, 1.45, 3.65, 2.15, "RECORDS ELEGÍVEIS", ["http_inbound / http_outbound", "config_binding", "topic_publish / topic_consume", "podem virar FrontierFacts"], DESIGN.inferred);
  addCard(slide, 8.5, 1.45, 4.2, 2.15, "FRONTIER FACT DERIVADO", ["l0:ff:<kind>:<hash16>", "identidade + origem + contract", "unidade que o L1 pode conectar"], DESIGN.frontier);
  slide.addShape("rightArrow", { x: 3.95, y: 2.25, w: 0.45, h: 0.3, fill: { color: DESIGN.text3 } });
  slide.addShape("rightArrow", { x: 7.9, y: 2.25, w: 0.45, h: 0.3, fill: { color: DESIGN.text3 } });
  addTable(slide, 0.6, 3.95, 12.1, 2.25, ["Campo do FrontierFact atual", "Exemplo derivado"], [
    ["id / kind", "l0:ff:http_outbound:<hash16> / http_outbound"],
    ["namespace / logical_repo / source_revision", "ns / cliente-service / git SHA aceito"],
    ["method / path / contract_key", "GET /addresses/{param} / GET /addresses/{param}"],
    ["config_key / topic", "address.api.url / opcional conforme kind"],
    ["file / line / evidence_snippet", "AddressClient.kt / 9 / rest.get(...addresses...)"],
  ], [3.8, 8.3]);
  slide.addText("IMPORTANTE: FrontierFacts NÃO são armazenados como frontier_facts[] dentro do package_json. Eles são derivados dos records na exportação/extração.", { x: 0.6, y: 6.45, w: 12.1, h: 0.45, fontFace: DESIGN.body, fontSize: 11.5, bold: true, color: DESIGN.missing, margin: 0 });
  slide.addNotes("FrontierFact é uma projeção derivada de records L0 elegíveis. Methods/classes comuns não viram facts. O package_json não contém frontier_facts array; o export/extract produz a fronteira para L1.");
}

function buildCurrentSlide09(pres) {
  const slide = pres.addSlide();
  slide.background = { color: DESIGN.bg0 };
  addTitleBar(slide, "Como o L0 é salvo hoje", "snapshot canônico imutável + ponteiro aceito pelo Human Gate");
  addFooter(slide, 9);
  addTable(slide, 0.6, 1.45, 5.9, 2.6, ["candidate_packages", "Tipo"], [
    ["candidate_id", "TEXT PK"], ["namespace / logical_repo", "TEXT"],
    ["source_revision", "TEXT"], ["canonical_graph_hash", "TEXT"],
    ["package_json", "TEXT"], ["created_at", "TEXT"],
  ], [3.0, 2.9]);
  addTable(slide, 6.8, 1.45, 5.9, 2.25, ["accepted_baselines", "Tipo"], [
    ["namespace / logical_repo", "PRIMARY KEY"], ["candidate_id", "FK → candidate_packages"],
    ["approver", "TEXT"], ["accepted_at", "TEXT"],
  ], [3.0, 2.9]);
  addCard(slide, 0.6, 4.35, 5.9, 1.75, "package_json — CONTEÚDO REAL", ["artifact_manifest", "records[] + relations[]", "graph_index + coverage_report", "não contém frontier_facts[]"], DESIGN.accent);
  addCard(slide, 6.8, 4.35, 5.9, 1.75, "CICLO ATUAL", ["finalize → candidate imutável", "canonical_graph_hash verifica o snapshot", "Human Gate → accepted_baselines", "aceitar troca apenas o ponteiro"], DESIGN.observed);
  slide.addText("O L0 é lido hoje como pacote completo. FrontierFacts são derivados dos records quando o L1 precisa da fronteira.", { x: 0.6, y: 6.4, w: 12.1, h: 0.42, fontFace: DESIGN.body, fontSize: 11.5, color: DESIGN.text2, margin: 0 });
  slide.addNotes("O modelo atual possui apenas candidate_packages e accepted_baselines. O pacote é imutável, content-addressed e lido inteiro; aceitação é um ponteiro explícito. FrontierFacts não são persistidos no blob.");
}

function buildCurrentSlide10(pres) {
  const slide = pres.addSlide();
  slide.background = { color: DESIGN.bg0 };
  addTitleBar(slide, "L1 — FrontierFacts de dois repos viram SystemEdge", "stitch por contrato normalizado, sempre cross-repo");
  addFooter(slide, 10);
  addNarrativeCircle(slide, 0.75, 2.0, "http_outbound", "cliente-service · l0:ff:*", DESIGN.inferred, true);
  addNarrativeCircle(slide, 5.9, 2.0, "http_inbound", "address-service · l0:ff:*", DESIGN.frontier, true);
  addNarrativeEdge(slide, 2.35, 2.72, 3.45, 0, "contract_key = GET /addresses/{param}", "matchFrontiers", DESIGN.observed);
  addCard(slide, 8.0, 1.45, 4.7, 2.55, "REGRAS DO MATCHER", ["config_binding correto → 0.95", "path_contract apenas → 0.55", "config aponta para outro repo → rejeita", "mesmo logical_repo → ignora"], DESIGN.observed);
  slide.addShape("downArrow", { x: 3.55, y: 4.15, w: 0.4, h: 0.7, fill: { color: DESIGN.text3 } });
  addCard(slide, 1.55, 5.0, 5.1, 1.25, "SystemEdge", ["l1:edge:<hash32>", "from.fact_id = l0:ff:http_outbound:*", "to.fact_id = l0:ff:http_inbound:*"], DESIGN.accent);
  addCard(slide, 8.0, 4.45, 4.7, 1.8, "REGRA ARQUITETURAL", ["L1 aponta para l0:ff:*", "nunca diretamente para l0:method:*", "porque L1 representa somente relações entre repos"], DESIGN.missing);
  slide.addNotes("L1 recebe fatos de fronteira de baselines aceitos, normaliza method/path em contract_key e produz apenas edges cross-repo. Config binding aumenta confiança; configuração contraditória rejeita o match.");
}

function buildCurrentSlide11(pres) {
  const slide = pres.addSlide();
  slide.background = { color: DESIGN.bg0 };
  addTitleBar(slide, "L1 SystemEdge — campos e persistência", "colunas consultáveis + objeto completo em edge_json");
  addFooter(slide, 11);
  addTable(slide, 0.6, 1.45, 6.0, 4.8, ["Campo do SystemEdge", "Significado atual"], [
    ["edge_id", "l1:edge:<hash32>"], ["from / to", "namespace, logical_repo, fact_id l0:ff:*"],
    ["contract_key", "método + path normalizados"], ["method / path", "contrato HTTP"],
    ["evidence_class", "contract-matched"], ["match_kind / score", "config_binding 0.95 ou path_contract 0.55"],
    ["config_key", "opcional"], ["evidence[]", "lado from/to + file/line/snippet/revision"],
  ], [2.3, 3.7]);
  addCard(slide, 6.9, 1.45, 5.8, 2.35, "system_edges", ["edge_id PK + system_namespace", "from_* / to_* + contract_key", "method/path/match_kind/score/config_key", "edge_json + created_at + id_version"], DESIGN.accent);
  addCard(slide, 6.9, 4.1, 5.8, 1.45, "system_stitch_runs", ["run_id + system_namespace", "repos_json + edge_count + created_at"], DESIGN.observed);
  slide.addText("Comportamento atual: INSERT OR IGNORE por edge_id torna o stitch idempotente. Não existe ponteiro current no L1; edges de runs diferentes acumulam.", { x: 6.9, y: 5.85, w: 5.8, h: 0.8, fontFace: DESIGN.body, fontSize: 11, color: DESIGN.inferred, margin: 0 });
  slide.addNotes("SystemEdge combina colunas normalizadas para busca e edge_json completo. Runs são registrados separadamente. O modelo atual não tem current edge set; edges acumulam idempotentemente.");
}

function buildCurrentSlide12(pres) {
  const slide = pres.addSlide();
  slide.background = { color: DESIGN.bg0 };
  addTitleBar(slide, "L2 — L1 propõe, L0 enriquece, Bind confirma", "L2 não nasce apenas do L1");
  addFooter(slide, 12);
  addCard(slide, 0.6, 1.45, 3.35, 1.55, "L1 system_edges", ["cliente-service → address-service", "contract + evidence + score"], DESIGN.observed);
  slide.addShape("rightArrow", { x: 4.1, y: 2.0, w: 0.65, h: 0.3, fill: { color: DESIGN.text3 } });
  addCard(slide, 4.9, 1.45, 3.45, 1.55, "propose-from-l1", ["agrupa edges", "cria JourneySpec skeleton", "ainda não afirma regra de negócio"], DESIGN.accent);
  slide.addShape("rightArrow", { x: 8.5, y: 2.0, w: 0.65, h: 0.3, fill: { color: DESIGN.text3 } });
  addCard(slide, 9.3, 1.45, 3.4, 1.55, "JourneySpec", ["members + steps", "contract_prefix + provenance", "pipeline.stage"], DESIGN.accent);
  addCard(slide, 0.6, 3.7, 3.35, 1.55, "L0 accepted packages", ["Methods / Services", "evidence files e body hotspots"], DESIGN.inferred);
  slide.addShape("rightArrow", { x: 4.1, y: 4.25, w: 0.65, h: 0.3, fill: { color: DESIGN.text3 } });
  addCard(slide, 4.9, 3.7, 3.45, 1.55, "enrich-from-l0", ["adiciona anchors", "body_read_required", "warnings se baseline/anchor faltar"], DESIGN.inferred);
  slide.addShape("rightArrow", { x: 8.5, y: 4.25, w: 0.65, h: 0.3, fill: { color: DESIGN.text3 } });
  addCard(slide, 9.3, 3.7, 3.4, 1.55, "bind", ["spec × L1 edges", "step = bound ou gap", "status complete ou partial"], DESIGN.observed);
  slide.addText("Fluxo real: L1 fornece os hops; L0 fornece os anchors do código; Bind confirma quais steps têm edges e quais permanecem gaps.", { x: 0.6, y: 6.0, w: 12.1, h: 0.55, fontFace: DESIGN.body, fontSize: 12, bold: true, color: DESIGN.text, margin: 0 });
  slide.addNotes("O pipeline L2 é bottom-up. L1 propõe o índice de integração; L0 enriquece com métodos/serviços e bloqueios de body read; bind marca bound/gap sem inventar narrativa.");
}

function buildCurrentSlide13(pres) {
  const slide = pres.addSlide();
  slide.background = { color: DESIGN.bg0 };
  addTitleBar(slide, "L2 — campos e persistência", "spec + bind imutáveis, índice reverso e ponteiro current");
  addFooter(slide, 13);
  addTable(slide, 0.6, 1.45, 6.0, 2.8, ["JourneySpec", "Campo atual"], [
    ["id / system_namespace", "identidade da jornada e sistema"], ["members[]", "logical_repos participantes"],
    ["steps[]", "id, trigger, from, to, contract_prefix, description"],
    ["provenance / pipeline", "edge_ids, match_kinds, evidence, stage"],
    ["enrichment", "l0_anchors, hotspots, warnings"],
  ], [2.2, 3.8]);
  addTable(slide, 6.9, 1.45, 5.8, 2.8, ["BindResult", "Campo atual"], [
    ["journey_id", "l2:journey:<spec.id>"], ["journey_hash / bind_id", "hash determinístico / l2:bind:<hash32>"],
    ["steps_bound / steps_gap", "contadores"], ["bound[] / gaps[]", "edges encontrados / reason"],
    ["status", "complete ou partial"],
  ], [2.2, 3.6]);
  addCard(slide, 0.6, 4.65, 3.0, 1.55, "journey_specs", ["spec_revision", "spec_json", "created_at"], DESIGN.accent);
  addCard(slide, 3.8, 4.65, 3.0, 1.55, "journey_binds", ["bind_id + journey_hash", "status/counts", "members_json + bind_json"], DESIGN.observed);
  addCard(slide, 7.0, 4.65, 2.7, 1.55, "journey_step_edges", ["bind_id", "step_id", "edge_id ou __gap__"], DESIGN.inferred);
  addCard(slide, 9.9, 4.65, 2.8, 1.55, "journey_current", ["system_namespace", "journey_id", "bind_id atual"], DESIGN.frontier);
  slide.addText("journey_current é o ponteiro do L2: list/show resolvem o bind atual, enquanto versões antigas permanecem preservadas.", { x: 0.6, y: 6.45, w: 12.1, h: 0.4, fontFace: DESIGN.body, fontSize: 11, color: DESIGN.text2, margin: 0 });
  slide.addNotes("L2 persiste specs e binds completos como JSON, além de metadados escalares. journey_step_edges indexa edge→jornada e journey_current resolve o bind atual.");
}

function buildCurrentSlide14(pres) {
  const slide = pres.addSlide();
  slide.background = { color: DESIGN.bg0 };
  addTitleBar(slide, "Context Slice — uma fatia do código para uma tarefa", "seleciona somente o pedaço relevante do grafo e o coloca na memória do agente");
  addFooter(slide, 14);

  addCard(slide, 0.55, 1.45, 3.45, 3.75, "1 · O SISTEMA INTEIRO", ["centenas de records L0", "relações dentro dos repos", "SystemEdges L1", "journeys L2", "informação demais para carregar"], DESIGN.text2);
  [[0.95, 2.45], [1.75, 2.0], [2.55, 2.65], [1.35, 3.35], [2.65, 3.75]].forEach(([x, y]) => {
    slide.addShape("ellipse", { x, y, w: 0.48, h: 0.48, fill: { color: DESIGN.bg3 }, line: { color: DESIGN.text3, width: 1 } });
  });
  slide.addShape("line", { x: 1.4, y: 2.55, w: 1.2, h: 0.28, line: { color: DESIGN.text3, width: 1 } });
  slide.addShape("line", { x: 1.55, y: 3.35, w: 1.2, h: 0.45, line: { color: DESIGN.text3, width: 1 } });

  slide.addShape("rightArrow", { x: 4.15, y: 2.95, w: 0.55, h: 0.3, fill: { color: DESIGN.text3 } });
  addCard(slide, 4.85, 1.45, 3.45, 3.75, "2 · SEED + POLICY RECORTAM", ["seed: AddressClient.get", "pergunta: por que falha?", "segue relações permitidas", "inclui L0 + L1 + L2", "registra misses e evidence"], DESIGN.accent);
  slide.addShape("ellipse", { x: 5.35, y: 3.25, w: 0.6, h: 0.6, fill: { color: DESIGN.accentSoft }, line: { color: DESIGN.accent, width: 2 } });
  slide.addShape("ellipse", { x: 6.35, y: 2.55, w: 0.6, h: 0.6, fill: { color: DESIGN.accentSoft }, line: { color: DESIGN.accent, width: 2 } });
  slide.addShape("ellipse", { x: 7.25, y: 3.25, w: 0.6, h: 0.6, fill: { color: DESIGN.accentSoft }, line: { color: DESIGN.accent, width: 2 } });
  slide.addShape("line", { x: 5.95, y: 3.45, w: 0.5, h: -0.5, line: { color: DESIGN.accent, width: 2, endArrowType: "triangle" } });
  slide.addShape("line", { x: 6.95, y: 2.95, w: 0.35, h: 0.5, line: { color: DESIGN.accent, width: 2, endArrowType: "triangle" } });

  slide.addShape("rightArrow", { x: 8.45, y: 2.95, w: 0.55, h: 0.3, fill: { color: DESIGN.text3 } });
  addCard(slide, 9.15, 1.45, 3.55, 3.75, "3 · SLICE NA MEMÓRIA", ["ClienteService.buscar", "AddressClient.get", "address.api.url", "SystemEdge → Address API", "Journey step + evidence"], DESIGN.observed);
  slide.addShape("roundedRectangle", { x: 9.55, y: 3.35, w: 2.75, h: 1.25, fill: { color: "0A0C0F" }, line: { color: DESIGN.observed, width: 1.5 }, rectRadius: 0.06 });
  slide.addText("AGENT CONTEXT\n[slice:<hash>]\nready to reason", { x: 9.75, y: 3.62, w: 2.35, h: 0.75, fontFace: DESIGN.mono, fontSize: 9, color: DESIGN.observed, align: "center", margin: 0 });

  slide.addText("Exemplos de uso", { x: 0.6, y: 5.55, w: 2.0, h: 0.28, fontFace: DESIGN.body, fontSize: 12, bold: true, color: DESIGN.text, margin: 0 });
  addCard(slide, 0.6, 5.9, 3.8, 0.85, "DEBUG", ["“por que a consulta de endereço falha?”"], DESIGN.missing);
  addCard(slide, 4.75, 5.9, 3.8, 0.85, "IMPACTO", ["“o que quebra se eu mudar este endpoint?”"], DESIGN.inferred);
  addCard(slide, 8.9, 5.9, 3.8, 0.85, "ONBOARDING", ["“como esse fluxo atravessa os serviços?”"], DESIGN.observed);
  slide.addNotes("Apresente como animação em três passos: primeiro o grafo inteiro, depois a seed e a policy selecionam uma fatia, por fim essa fatia entra na memória do agente. O Slice é completo para aquela derivação: contém os nodes, edges, misses e evidence necessários à tarefa, sem carregar o sistema inteiro.");
}

function buildCurrentSlide15(pres) {
  const slide = pres.addSlide();
  slide.background = { color: DESIGN.bg0 };
  addTitleBar(slide, "Query — como o contexto é buscado e carregado", "da pergunta do usuário até o Pack dentro da memória do agente");
  addFooter(slide, 15);

  slide.addShape("roundedRectangle", { x: 0.6, y: 1.35, w: 12.1, h: 0.75, fill: { color: "0A0C0F" }, line: { color: DESIGN.accent, width: 1.5 }, rectRadius: 0.06 });
  slide.addText("QUERY  ›  “Por que a consulta de endereço falha?”", { x: 0.9, y: 1.57, w: 11.5, h: 0.3, fontFace: DESIGN.mono, fontSize: 15, bold: true, color: DESIGN.text, margin: 0 });

  addCard(slide, 0.6, 2.4, 3.65, 1.55, "1 · INTERPRETAR", ["seed = AddressClient.get", "policy = dependency-neighborhood", "namespace + pergunta"], DESIGN.accent);
  slide.addShape("rightArrow", { x: 4.4, y: 3.0, w: 0.55, h: 0.28, fill: { color: DESIGN.text3 } });
  addCard(slide, 5.1, 2.4, 3.2, 1.55, "2 · DERIVATION KEY", ["seeds + policy", "L0 hashes + L1 edge set", "L2 journey hashes + versions"], DESIGN.inferred);
  slide.addShape("rightArrow", { x: 8.45, y: 3.0, w: 0.55, h: 0.28, fill: { color: DESIGN.text3 } });
  addCard(slide, 9.15, 2.4, 3.55, 1.55, "3 · BUSCAR SLICE", ["lookup por derivation_key/current", "HIT → reutiliza slice:<hash>", "MISS → materializa L0+L1+L2"], DESIGN.observed);

  addCard(slide, 0.6, 4.4, 3.65, 1.55, "4 · CRIAR PACK", ["budget = 1.200 tokens", "prioriza seed + caminho crítico", "mantém evidence e pointers"], DESIGN.inferred);
  slide.addShape("rightArrow", { x: 4.4, y: 5.0, w: 0.55, h: 0.28, fill: { color: DESIGN.text3 } });
  addCard(slide, 5.1, 4.4, 3.2, 1.55, "5 · CARREGAR MEMÓRIA", ["pack:<hash> entra no context", "Service → Client → API", "config + edge + file:line"], DESIGN.accent);
  slide.addShape("rightArrow", { x: 8.45, y: 5.0, w: 0.55, h: 0.28, fill: { color: DESIGN.text3 } });
  addCard(slide, 9.15, 4.4, 3.55, 1.55, "6 · AGENTE RESPONDE", ["raciocina só sobre a fatia", "cita ClienteService.kt:10", "aponta config/edge/miss relevante"], DESIGN.observed);

  slide.addShape("roundedRectangle", { x: 0.6, y: 6.25, w: 12.1, h: 0.55, fill: { color: DESIGN.bg2 }, line: { color: DESIGN.bg3, width: 1 }, rectRadius: 0.04 });
  slide.addText("HIT evita reconstrução. MISS materializa e persiste. Em ambos os casos, o agente recebe o Pack — não o banco inteiro nem todo o repositório.", { x: 0.85, y: 6.4, w: 11.6, h: 0.25, fontFace: DESIGN.body, fontSize: 11, bold: true, color: DESIGN.text2, align: "center", margin: 0 });
  slide.addNotes("Percorra o fluxo da esquerda para a direita e depois a segunda linha. A query vira seed e policy; a derivation key identifica exatamente os inputs L0/L1/L2. Se já existe Slice equivalente, ocorre cache hit; caso contrário ele é materializado. O budget transforma o Slice em Pack, que é inserido na janela de contexto do agente. A resposta usa apenas essa fatia e mantém evidence para justificar cada conclusão.");
}

function buildCurrentSlide16(pres) {
  const slide = pres.addSlide();
  slide.background = { color: DESIGN.bg0 };
  addTitleBar(slide, "Portable Evidence — como o código entra na memória", "Pack guarda identidade lógica; Hydrator resolve e verifica os bytes na máquina atual");
  addFooter(slide, 16);

  addCard(slide, 0.55, 1.45, 3.25, 3.8, "1 · POINTER PORTÁTIL", ["logical_repo: cliente-service", "revision: a1b2c3d", "path: src/.../ClienteService.kt", "range: L38-L52", "content_sha256", "sem /Users, /home ou C:\\"], DESIGN.accent);
  slide.addText("repo://cliente-service@a1b2c3d/\nsrc/.../ClienteService.kt#L38-L52", { x: 0.85, y: 4.35, w: 2.65, h: 0.55, fontFace: DESIGN.mono, fontSize: 8.5, color: DESIGN.accent, align: "center", margin: 0 });
  slide.addShape("rightArrow", { x: 3.95, y: 3.0, w: 0.55, h: 0.3, fill: { color: DESIGN.text3 } });

  addCard(slide, 4.65, 1.45, 3.25, 3.8, "2 · CONTEXT HYDRATOR", ["resolve RepoBinding local", "lê revisão exata via Git", "bloqueia path escape", "recorta range/símbolo", "verifica content_sha256", "falha fechado se divergir"], DESIGN.inferred);
  slide.addShape("roundedRectangle", { x: 5.05, y: 4.25, w: 2.45, h: 0.7, fill: { color: "0A0C0F" }, line: { color: DESIGN.inferred, width: 1 }, rectRadius: 0.04 });
  slide.addText("git show a1b2c3d:\nsrc/.../ClienteService.kt", { x: 5.2, y: 4.43, w: 2.15, h: 0.34, fontFace: DESIGN.mono, fontSize: 8, color: DESIGN.inferred, align: "center", margin: 0 });
  slide.addShape("rightArrow", { x: 8.05, y: 3.0, w: 0.55, h: 0.3, fill: { color: DESIGN.text3 } });

  addCard(slide, 8.75, 1.45, 3.95, 3.8, "3 · AGENT CONTEXT ENVELOPE", ["Pack + pergunta", "código obrigatório hidratado", "pointers opcionais para leitura lazy", "hash_verified=true", "ContextLoadReceipt", "evidence IDs disponíveis para citação"], DESIGN.observed);
  slide.addShape("roundedRectangle", { x: 9.2, y: 4.2, w: 3.05, h: 0.82, fill: { color: "0A0C0F" }, line: { color: DESIGN.observed, width: 1 }, rectRadius: 0.04 });
  slide.addText("required: 5 · loaded: 5\nfailed: 0 · hash verified: 5", { x: 9.4, y: 4.43, w: 2.65, h: 0.38, fontFace: DESIGN.mono, fontSize: 8.5, color: DESIGN.observed, align: "center", margin: 0 });

  addCard(slide, 0.6, 5.7, 5.8, 1.0, "EAGER", ["seeds, caminho crítico, configs e evidence entram antes da primeira chamada do LLM"], DESIGN.accent);
  addCard(slide, 6.8, 5.7, 5.9, 1.0, "LAZY", ["vizinhos secundários ficam como pointers e usam read_code_pointer(evidence_id)"], DESIGN.frontier);
  slide.addNotes("O modelo não abre arquivos sozinho. O Pack possui pointers portáveis. O RepoBinding existe somente na máquina local. O Hydrator lê a revisão exata, valida path/range/hash e cria o AgentContextEnvelope. O ContextLoadReceipt prova quais bytes foram realmente colocados no contexto.");
}

function buildCurrentSlide17(pres) {
  const slide = pres.addSlide();
  slide.background = { color: DESIGN.bg0 };
  addTitleBar(slide, "Knowledge Repository — Git canônico, SQLite local", "memória arquitetural da empresa revisada por PR, sem banco central");
  addFooter(slide, 17);

  addCard(slide, 0.55, 1.4, 3.25, 4.25, "SERVICE REPOSITORIES", ["cliente-service @ sha A", "address-service @ sha B", "payment-service @ sha C", "novos serviços ou features", "indexação por logical_repo"], DESIGN.text2);
  slide.addShape("rightArrow", { x: 3.95, y: 3.25, w: 0.55, h: 0.3, fill: { color: DESIGN.text3 } });

  addCard(slide, 4.65, 1.4, 3.55, 4.25, "KNOWLEDGE REPO · GIT", ["objects/l0/<hash>.json.zst", "objects/l1/<hash>.json.zst", "objects/l2/<hash>.json.zst", "refs/repos/*.json", "refs/systems/*.json", "manifest.lock", "semantic diff revisável"], DESIGN.accent);
  slide.addShape("rightArrow", { x: 8.35, y: 3.25, w: 0.55, h: 0.3, fill: { color: DESIGN.text3 } });

  addCard(slide, 9.05, 1.4, 3.65, 4.25, "LOCAL MATERIALIZED VIEW", ["company-context.sqlite", "gerado pelo manifest.lock", "consulta rápida e offline", "pode ser apagado/reconstruído", "opcional em Release ou Git LFS", "nunca é a única fonte de verdade"], DESIGN.observed);

  slide.addShape("roundedRectangle", { x: 0.6, y: 5.95, w: 12.1, h: 0.75, fill: { color: DESIGN.bg2 }, line: { color: DESIGN.bg3, width: 1 }, rectRadius: 0.05 });
  slide.addText("branch → novos objects/refs → semantic diff → PR → CI valida hashes/revisions → recalcula L1/L2 → Human Gate/CODEOWNERS → merge → novo SQLite", { x: 0.85, y: 6.15, w: 11.6, h: 0.32, fontFace: DESIGN.mono, fontSize: 9.5, color: DESIGN.text, align: "center", margin: 0 });
  slide.addText("Por que não versionar só o SQLite?", { x: 0.7, y: 5.58, w: 3.2, h: 0.25, fontFace: DESIGN.body, fontSize: 10.5, bold: true, color: DESIGN.missing, margin: 0 });
  slide.addText("Binário não tem merge/diff semântico. Objects imutáveis isolam conflitos; SQLite é regenerado.", { x: 3.3, y: 5.58, w: 9.2, h: 0.25, fontFace: DESIGN.body, fontSize: 10.5, color: DESIGN.text2, margin: 0 });
  slide.addNotes("A colaboração acontece sobre objetos e refs canônicos no Git. Cada PR mostra mudanças semânticas L0/L1/L2. O SQLite permanece como índice local rápido, gerado do manifest e reconstruível. Assim duas branches podem indexar serviços diferentes sem disputar um único binário global.");
}

function buildCurrentSlide18(pres) {
  const slide = pres.addSlide();
  slide.background = { color: DESIGN.bg0 };
  addTitleBar(slide, "Pipeline completo — quem interpreta, quem prova, quem decide", "LLM raciocina · código determinístico constrói/verifica · humano aceita");
  addFooter(slide, 18);

  const deterministic = DESIGN.observed;
  const llm = DESIGN.accent;
  const human = DESIGN.inferred;
  slide.addShape("ellipse", { x: 8.7, y: 0.38, w: 0.22, h: 0.22, fill: { color: deterministic }, line: { color: deterministic } });
  slide.addText("DETERMINÍSTICO", { x: 8.98, y: 0.39, w: 1.25, h: 0.2, fontFace: DESIGN.body, fontSize: 8.5, color: deterministic, margin: 0 });
  slide.addShape("ellipse", { x: 10.25, y: 0.38, w: 0.22, h: 0.22, fill: { color: llm }, line: { color: llm } });
  slide.addText("LLM", { x: 10.53, y: 0.39, w: 0.55, h: 0.2, fontFace: DESIGN.body, fontSize: 8.5, color: llm, margin: 0 });
  slide.addShape("ellipse", { x: 11.15, y: 0.38, w: 0.22, h: 0.22, fill: { color: human }, line: { color: human } });
  slide.addText("HUMAN GATE", { x: 11.43, y: 0.39, w: 1.0, h: 0.2, fontFace: DESIGN.body, fontSize: 8.5, color: human, margin: 0 });

  slide.addText("BUILD ↑", { x: 0.55, y: 1.35, w: 1.0, h: 0.3, fontFace: DESIGN.body, fontSize: 12, bold: true, color: DESIGN.text, margin: 0 });
  const buildStages = [
    ["Código", deterministic], ["Graphify", deterministic], ["Explorer", llm],
    ["Finalize", deterministic], ["Human Gate", human], ["L0/L1/L2", deterministic],
  ];
  buildStages.forEach(([label, color], index) => {
    const x = 0.55 + index * 2.08;
    slide.addShape("roundedRectangle", { x, y: 1.75, w: 1.62, h: 0.75, fill: { color: DESIGN.bg1 }, line: { color, width: 1.7 }, rectRadius: 0.05 });
    slide.addText(label, { x, y: 1.98, w: 1.62, h: 0.25, fontFace: DESIGN.body, fontSize: 10.5, bold: true, color, align: "center", margin: 0 });
    if (index < buildStages.length - 1) slide.addShape("rightArrow", { x: x + 1.68, y: 2.02, w: 0.3, h: 0.2, fill: { color: DESIGN.text3 } });
  });

  slide.addText("QUERY ↓", { x: 0.55, y: 3.0, w: 1.0, h: 0.3, fontFace: DESIGN.body, fontSize: 12, bold: true, color: DESIGN.text, margin: 0 });
  const queryStages = [
    ["Pergunta", llm], ["QueryRequest", deterministic], ["Slice", deterministic],
    ["Pack", deterministic], ["Hydrator", deterministic], ["Agent Context", deterministic],
  ];
  queryStages.forEach(([label, color], index) => {
    const x = 0.55 + index * 2.08;
    slide.addShape("roundedRectangle", { x, y: 3.4, w: 1.62, h: 0.75, fill: { color: DESIGN.bg1 }, line: { color, width: 1.7 }, rectRadius: 0.05 });
    slide.addText(label, { x, y: 3.63, w: 1.62, h: 0.25, fontFace: DESIGN.body, fontSize: 10.2, bold: true, color, align: "center", margin: 0 });
    if (index < queryStages.length - 1) slide.addShape("rightArrow", { x: x + 1.68, y: 3.67, w: 0.3, h: 0.2, fill: { color: DESIGN.text3 } });
  });

  slide.addText("EXECUTE", { x: 0.55, y: 4.65, w: 1.0, h: 0.3, fontFace: DESIGN.body, fontSize: 12, bold: true, color: DESIGN.text, margin: 0 });
  const executeStages = [
    ["Task Agent", llm], ["Tools", deterministic], ["TaskOutcome", deterministic],
    ["Citation Check", deterministic], ["Review Agent", llm], ["Human Gate?", human],
  ];
  executeStages.forEach(([label, color], index) => {
    const x = 0.55 + index * 2.08;
    slide.addShape("roundedRectangle", { x, y: 5.05, w: 1.62, h: 0.75, fill: { color: DESIGN.bg1 }, line: { color, width: 1.7 }, rectRadius: 0.05 });
    slide.addText(label, { x, y: 5.28, w: 1.62, h: 0.25, fontFace: DESIGN.body, fontSize: 10.2, bold: true, color, align: "center", margin: 0 });
    if (index < executeStages.length - 1) slide.addShape("rightArrow", { x: x + 1.68, y: 5.32, w: 0.3, h: 0.2, fill: { color: DESIGN.text3 } });
  });

  slide.addShape("roundedRectangle", { x: 0.6, y: 6.2, w: 12.1, h: 0.58, fill: { color: DESIGN.bg2 }, line: { color: DESIGN.bg3, width: 1 }, rectRadius: 0.04 });
  slide.addText("LLM interpreta e executa. Código determinístico seleciona, verifica, hidrata e valida. Humano aceita fatos canônicos e mudanças de alto impacto.", { x: 0.85, y: 6.37, w: 11.6, h: 0.25, fontFace: DESIGN.body, fontSize: 11, bold: true, color: DESIGN.text, align: "center", margin: 0 });
  slide.addNotes("Use as cores para explicar responsabilidade. O Explorer e o Query Interpreter/Task Agent usam LLM. Todos os IDs, hashes, matches, traversal, Slice, Pack, hidratação, tools e citation check são determinísticos. Human Gate permanece na aceitação do baseline e pode reaparecer em mudanças de alto impacto.");
}

// === MAIN ===
function main() {
  const targetDir = path.resolve(__dirname);
  const targetFile = path.join(targetDir, "context-slice-descobrir.pptx");

  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE";
  pres.author = "ai-dev-harness";
  pres.title = "Context Slice · Descobrir";
  pres.subject = "Pipeline determinístico L0→L1→L2→Slice→Pack";

  // Build all 18 slides
  buildSlide01(pres);
  buildSlide02(pres);
  buildSlide03(pres);
  buildCurrentSlide04(pres);
  buildCurrentSlide05(pres);
  buildCurrentSlide06(pres);
  buildCurrentSlide07(pres);
  buildCurrentSlide08(pres);
  buildCurrentSlide09(pres);
  buildCurrentSlide10(pres);
  buildCurrentSlide11(pres);
  buildCurrentSlide12(pres);
  buildCurrentSlide13(pres);
  buildCurrentSlide14(pres);
  buildCurrentSlide15(pres);
  buildCurrentSlide16(pres);
  buildCurrentSlide17(pres);
  buildCurrentSlide18(pres);

  // Write
  pres.writeFile({ fileName: targetFile })
    .then(() => {
      console.log(`[OK] Deck written to ${targetFile}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[ERR] Failed to write deck:", err);
      process.exit(1);
    });
}

main();
