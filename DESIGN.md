---
name: Al-Ghaith Gold Bot Dashboard
version: 1.0.0
author: Antigravity
description: Design system and visual guidelines for Al-Ghaith Gold Bot and Simulator Dashboard.
tokens:
  colors:
    backgrounds:
      primary: "#f3f6f9"
      secondary: "#ffffff"
      tertiary: "#f8fafc"
    brand:
      gold: "#ffd700"
      gold-dark: "#3b2806"
      gold-premium: "#d4af37"
      indigo: "#4b4df1"
      indigo-bright: "#3b3df0"
      indigo-glow: "rgba(75, 77, 241, 0.15)"
    text:
      primary: "#131238"
      secondary: "#64748b"
    borders:
      default: "#e2e8f0"
      focus: "#4b4df1"
    whatsapp:
      bg: "#efeae2"
      header: "#f0f2f5"
      green: "#00e676"
      incoming: "#ffffff"
      outgoing: "#d9fdd3"
  typography:
    fonts:
      primary: "Cairo, Inter, sans-serif"
    weights:
      light: 300
      regular: 400
      medium: 500
      semibold: 600
      bold: 700
      extra-bold: 800
---

# Al-Ghaith Gold Bot Dashboard Design System

This document defines the brand style and design language for the **Al-Ghaith Gold Bot & Simulator Dashboard** to ensure visual consistency when generating or modifying interfaces using AI design tools like Google Stitch.

## Visual Direction
The design language blends modern, tech-forward dashboard components with traditional premium gold shop branding.

- **Branding Elements:** Utilizes laurel leaves, diamond shapes, and premium gold gradients (`#ffd700` to `#ffe194` and `#d4af37`) for client-facing identity cards.
- **Dashboard Interface:** Uses clean, modern glassmorphism panels, indigo-accented buttons, and an aesthetic dark-text on light-gray background to present real-time rates clearly.
- **WhatsApp Simulator:** Mimics the official WhatsApp light web mode using traditional messaging colors (`#efeae2` chat background, `#d9fdd3` outgoing bubble, and `#ffffff` incoming bubble).

## Layout Guidelines
- **Responsive Grid:** The dashboard uses a multi-column responsive layout.
- **Cards:** Glassmorphism styled panels with subtle borders (`#e2e8f0`) and soft shadows to organize control inputs, pricing displays, and live chat logs.
- **Visual Status:** Uses live status badges with pulse dots to display server connection state.
