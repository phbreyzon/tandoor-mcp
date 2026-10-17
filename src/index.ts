#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import { TandoorClient } from './clients/index.js';
import { RECIPE_TOOLS } from './tools/recipe.js';
import { MEAL_PLAN_TOOLS } from './tools/mealplan.js';
import {
  handleListRecipes,
  handleGetRecipe,
  handleCreateRecipe,
  handleUpdateRecipe,
  handleDeleteRecipe,
  handleListFoods,
  handleListUnits,
  handleListKeywords,
} from './handlers/recipe.js';
import {
  handleListMealPlans,
  handleGetMealPlan,
  handleCreateMealPlan,
  handleUpdateMealPlan,
  handleDeleteMealPlan,
  handleAutoMealPlan,
  handleListMealTypes,
  handleGetShoppingList,
} from './handlers/mealplan.js';

// Load environment variables
dotenv.config();

const ALL_TOOLS = [...RECIPE_TOOLS, ...MEAL_PLAN_TOOLS];

/**
 * Some MCP clients/models serialize nested object or array arguments as a JSON
 * *string* (e.g. `nutrition: "{\"calories\":305}"` instead of an object). The
 * handlers expect real objects/arrays, so a stringified value silently no-ops
 * (or worse, iterates its characters). Coerce any argument whose schema expects
 * an object/array back into parsed JSON before dispatching.
 */
function schemaExpectsObjectOrArray(schema: any): boolean {
  if (!schema) return false;
  const isObjArr = (t: any) =>
    t === 'object' ||
    t === 'array' ||
    (Array.isArray(t) && (t.includes('object') || t.includes('array')));
  if (isObjArr(schema.type)) return true;
  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    if (Array.isArray(schema[key]) && schema[key].some(schemaExpectsObjectOrArray)) {
      return true;
    }
  }
  return false;
}

function coerceJsonArgs(value: any, schema: any): any {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    if (!schemaExpectsObjectOrArray(schema)) return value;
    try {
      return coerceJsonArgs(JSON.parse(value), schema);
    } catch {
      return value;
    }
  }

  if (Array.isArray(value)) {
    const itemSchema = schema?.items;
    return value.map(v => coerceJsonArgs(v, itemSchema));
  }

  if (typeof value === 'object') {
    const props = schema?.properties;
    if (!props) return value;
    const out: Record<string, any> = { ...value };
    for (const key of Object.keys(out)) {
      out[key] = coerceJsonArgs(out[key], props[key]);
    }
    return out;
  }

  return value;
}

const TANDOOR_URL = process.env.TANDOOR_URL;
const TANDOOR_TOKEN = process.env.TANDOOR_TOKEN;

if (!TANDOOR_URL || !TANDOOR_TOKEN) {
  console.error('Error: TANDOOR_URL and TANDOOR_TOKEN must be set in .env file');
  process.exit(1);
}

// Initialize Tandoor client
const tandoorClient = new TandoorClient({
  url: TANDOOR_URL,
  token: TANDOOR_TOKEN,
});

// Create MCP server
const server = new Server(
  {
    name: 'tandoor-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: ALL_TOOLS,
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  const schema = ALL_TOOLS.find(t => t.name === name)?.inputSchema;
  const args = coerceJsonArgs(rawArgs, schema);

  try {
    let text: string;

    switch (name) {
      // Recipe tools
      case 'list_recipes':
        text = await handleListRecipes(tandoorClient, args);
        break;

      case 'get_recipe':
        text = await handleGetRecipe(tandoorClient, args as { id: number });
        break;

      case 'create_recipe':
        text = await handleCreateRecipe(tandoorClient, args);
        break;

      case 'update_recipe':
        text = await handleUpdateRecipe(tandoorClient, args);
        break;

      case 'delete_recipe':
        text = await handleDeleteRecipe(tandoorClient, args as { id: number });
        break;

      case 'list_foods':
        text = await handleListFoods(tandoorClient, args as { query?: string });
        break;

      case 'list_units':
        text = await handleListUnits(tandoorClient, args as { query?: string });
        break;

      case 'list_keywords':
        text = await handleListKeywords(tandoorClient, args as { query?: string });
        break;

      // Meal plan tools
      case 'list_meal_plans':
        text = await handleListMealPlans(tandoorClient, args);
        break;

      case 'get_meal_plan':
        text = await handleGetMealPlan(tandoorClient, args as { id: number });
        break;

      case 'create_meal_plan':
        text = await handleCreateMealPlan(tandoorClient, args);
        break;

      case 'update_meal_plan':
        text = await handleUpdateMealPlan(tandoorClient, args);
        break;

      case 'delete_meal_plan':
        text = await handleDeleteMealPlan(tandoorClient, args as { id: number });
        break;

      case 'auto_meal_plan':
        text = await handleAutoMealPlan(tandoorClient, args);
        break;

      case 'list_meal_types':
        text = await handleListMealTypes(tandoorClient, args);
        break;

      case 'get_shopping_list':
        text = await handleGetShoppingList(tandoorClient, args);
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [{ type: 'text', text }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Tandoor MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
