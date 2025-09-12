# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an AWS Amplify React+Vite application that integrates with Figma for design automation. The app uses AWS Amplify Gen 2 for backend services including authentication (Cognito), GraphQL API (AppSync), and real-time database (DynamoDB).

## Development Commands

- **Start development server**: `npm run dev`
- **Build for production**: `npm run build`
- **Lint code**: `npm run lint`
- **Preview production build**: `npm run preview`

## Architecture

### Frontend Structure
- **React 18** with **Vite** as the build tool
- **TypeScript** for type safety
- **AWS Amplify UI React** components for authentication and UI
- Main entry point: `src/main.tsx` configures Amplify and renders the App
- Primary component: `src/App.tsx` contains the todo list application

### Backend Structure (Amplify Gen 2)
- **Configuration**: `amplify/backend.ts` defines the backend resources
- **Authentication**: `amplify/auth/resource.ts` - Email-based authentication with Cognito
- **Data Layer**: `amplify/data/resource.ts` - GraphQL schema with Todo model using public API key authorization
- **Deployment**: `amplify.yml` configures the build and deployment pipeline

### Figma Integration Scripts
Located in `src/scripts/`:
- Scripts for fetching Figma file structures and variables
- Uses environment variables for Figma API access (`FIGMA_TOKEN`, `FIGMA_FILE_ID`)
- Node.js scripts that interact with Figma REST API

## Key Dependencies

- **aws-amplify**: Core Amplify library for client-side integration
- **@aws-amplify/ui-react**: Pre-built React components
- **@aws-amplify/backend**: Backend resource definitions
- **aws-cdk-lib**: AWS CDK for infrastructure as code

## Environment Variables

Required environment variables (see `.env.example`):
- `FIGMA_TOKEN`: Personal access token for Figma API
- `FIGMA_FILE_ID`: ID of the Figma file to work with

## Data Model

The current schema includes a simple `Todo` model with:
- `content`: string field for todo text
- Public API key authorization allowing CRUD operations

## Development Notes

- The app uses Amplify's real-time subscriptions via `client.models.Todo.observeQuery()`
- ESLint configuration enforces TypeScript and React hooks best practices
- Build process includes TypeScript compilation followed by Vite bundling
- Amplify outputs are auto-generated in `amplify_outputs.json`