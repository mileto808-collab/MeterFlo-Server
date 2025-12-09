# Design Guidelines: Work Order Management System

## Design Approach
**System:** Modern Enterprise Dashboard Design - inspired by Linear, Notion, and Carbon Design System  
**Rationale:** Utility-focused productivity tool requiring clarity, efficiency, and role-based interface differentiation. Prioritizes data readability, quick task completion, and minimal cognitive load.

## Core Design Principles
1. **Information Hierarchy:** Clear visual distinction between critical data, actions, and metadata
2. **Role-Based UI:** Distinct layouts for Admin, User, and Customer portals while maintaining brand consistency
3. **Data Density:** Optimized for scanning large datasets without overwhelming users
4. **Action Clarity:** Always-visible primary actions, no buried functionality

## Typography System
- **Primary Font:** Inter or Work Sans (Google Fonts)
- **Monospace:** JetBrains Mono for order IDs, timestamps, technical data
- **Scale:**
  - Page titles: text-3xl font-bold
  - Section headers: text-xl font-semibold
  - Card titles: text-lg font-medium
  - Body text: text-base
  - Metadata/labels: text-sm text-gray-600
  - Table data: text-sm

## Layout & Spacing System
**Tailwind Units:** Consistently use 2, 4, 6, 8, 12, 16 for all spacing (padding, margins, gaps)

**Layout Structure:**
- **Sidebar Navigation:** Fixed 64px width (collapsed) or 240px (expanded) - persistent across all views
- **Main Content Area:** max-w-7xl with px-6 py-8 for breathing room
- **Cards/Panels:** Rounded corners (rounded-lg), shadow-sm, p-6
- **Grid Systems:** 
  - Dashboard: grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6
  - Tables: Full-width with alternating row backgrounds
  - Forms: Single column max-w-2xl for focused data entry

## Component Library

### Navigation
- **Admin/User Portal:** Vertical sidebar with icon + label, collapsible for mobile
- **Customer Portal:** Horizontal top navigation (simpler, limited access)
- **Breadcrumbs:** Always visible in header for deep navigation
- **Active states:** Subtle left border (4px) + background treatment

### Dashboard Cards
- **Stat Cards:** Icon, large number (text-4xl), label, trend indicator
- **Quick Actions:** Large clickable areas (min-h-24) with icons and clear labels
- **Recent Activity:** Compact list with timestamps, user avatars, status badges

### Data Tables
- **Structure:** Sticky header, hover row highlights, sortable columns
- **Row Actions:** Always-visible icons (edit, delete, view) on row hover
- **Pagination:** Bottom-right with page numbers and totals
- **Filters:** Top toolbar with dropdowns, search, and date pickers
- **Empty States:** Centered icon, message, and primary CTA

### Forms
- **Input Fields:** Consistent height (h-10), clear labels above, help text below
- **File Upload:** Drag-and-drop zone with browse fallback, progress indicators
- **Validation:** Inline errors (text-red-600) with icons
- **Submit Area:** Fixed bottom bar on mobile, right-aligned on desktop

### Status Indicators
- **Work Order States:** Pill-shaped badges (rounded-full px-3 py-1) for Pending/In Progress/Completed
- **Priority Levels:** Color-coded subtle backgrounds (avoid pure red/yellow/green)
- **User Roles:** Small badges next to usernames in admin views

### Modals & Overlays
- **Confirmation Dialogs:** Centered, max-w-md, clear destructive vs. safe actions
- **Work Order Detail View:** Slide-out panel (right side) with full order information
- **Loading States:** Skeleton screens for tables, spinners for actions

## Portal-Specific Guidelines

### Admin Dashboard
- **Density:** Higher information density, multi-column layouts
- **Navigation:** Full sidebar with all system functions
- **Focus:** User management tables, system metrics, bulk actions

### User Portal (Work Order Management)
- **Primary View:** Kanban board OR table view toggle
- **Quick Access:** Search bar prominence, frequent filters pinned
- **Mobile Optimization:** Simplified card view for work orders on small screens

### Customer Portal
- **Simplified UI:** Clean, read-only focus with minimal chrome
- **Key Feature:** Filterable work order list with export capability
- **Trust Elements:** Completion timestamps, uploaded photos/documents preview

## Interactions & Micro-animations
- **Hover States:** Subtle opacity/background changes (no dramatic effects)
- **Transitions:** Fast (150-200ms) for interactive elements
- **Loading:** Determinate progress bars for uploads, spinners for data fetching
- **Avoid:** Page transitions, scroll-triggered animations, decorative motion

## Accessibility Standards
- **Keyboard Navigation:** Full tab order, focus indicators (ring-2 ring-blue-500)
- **ARIA Labels:** All icon-only buttons, table sorting, form validation
- **Contrast:** WCAG AA minimum for all text and interactive elements
- **Touch Targets:** Minimum 44x44px for all clickable elements

## Images
**Usage:** Minimal - this is a data-centric application
- **Login Page:** Optional subtle background pattern or gradient (no hero image)
- **Empty States:** Simple illustrations for "No work orders" states
- **User Avatars:** Circular (rounded-full) in navigation and activity feeds
- **Work Order Attachments:** Thumbnail previews in 4:3 aspect ratio

**No large hero images required** - focus is on immediate access to functionality.