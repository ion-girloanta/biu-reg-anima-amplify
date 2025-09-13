import https from 'https';
import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FILE_KEY = process.env.FIGMA_FILE_ID;

// Keywords that indicate interactive elements
const INTERACTIVE_KEYWORDS = [
  'button', 'btn', 'cta', 'link', 'hover', 'active', 'pressed', 'disabled',
  'focus', 'click', 'tap', 'input', 'field', 'form', 'checkbox', 'radio',
  'toggle', 'switch', 'dropdown', 'menu', 'nav', 'navigation'
];

// State keywords
const STATE_KEYWORDS = {
  hover: ['hover', 'over', 'rollover'],
  active: ['active', 'pressed', 'down', 'click'],
  focus: ['focus', 'focused', 'highlight'],
  disabled: ['disabled', 'inactive', 'gray', 'grey']
};

function makeRequest(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.figma.com',
      port: 443,
      path: path,
      method: 'GET',
      headers: {
        'X-FIGMA-TOKEN': FIGMA_TOKEN
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.status && json.status !== 200) {
            reject(new Error(`API Error: ${json.err || json.message}`));
          } else {
            resolve(json);
          }
        } catch (error) {
          reject(new Error(`JSON Parse Error: ${error.message}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
}

function identifyInteractiveElements(node, interactives = []) {
  const name = node.name.toLowerCase();
  
  // Check if this is an interactive element
  const isInteractive = INTERACTIVE_KEYWORDS.some(keyword => 
    name.includes(keyword)
  ) || node.type === 'INSTANCE';
  
  if (isInteractive) {
    const elementInfo = {
      id: node.id,
      name: node.name,
      type: node.type,
      componentId: node.componentId,
      bounds: node.absoluteBoundingBox,
      states: identifyStates(name),
      styling: extractStyling(node),
      interactionType: determineInteractionType(name)
    };
    
    interactives.push(elementInfo);
  }
  
  if (node.children) {
    node.children.forEach(child => identifyInteractiveElements(child, interactives));
  }
  
  return interactives;
}

function identifyStates(name) {
  const states = {
    default: true,
    hover: false,
    active: false,
    focus: false,
    disabled: false
  };
  
  Object.entries(STATE_KEYWORDS).forEach(([state, keywords]) => {
    if (keywords.some(keyword => name.includes(keyword))) {
      states[state] = true;
    }
  });
  
  return states;
}

function extractStyling(node) {
  const styling = {};
  
  // Background color
  if (node.fills && node.fills.length > 0) {
    const solidFill = node.fills.find(fill => fill.type === 'SOLID');
    if (solidFill && solidFill.color) {
      const { r, g, b } = solidFill.color;
      styling.backgroundColor = {
        r: Math.round(r * 255),
        g: Math.round(g * 255),
        b: Math.round(b * 255),
        alpha: solidFill.opacity || 1
      };
    }
  }
  
  // Border
  if (node.strokes && node.strokes.length > 0) {
    const stroke = node.strokes[0];
    if (stroke.color) {
      const { r, g, b } = stroke.color;
      styling.border = {
        width: node.strokeWeight || 1,
        color: {
          r: Math.round(r * 255),
          g: Math.round(g * 255),
          b: Math.round(b * 255),
          alpha: stroke.opacity || 1
        }
      };
    }
  }
  
  // Border radius
  if (node.cornerRadius !== undefined) {
    styling.borderRadius = node.cornerRadius;
  }
  
  // Shadow
  if (node.effects && node.effects.length > 0) {
    const shadow = node.effects.find(effect => effect.type === 'DROP_SHADOW');
    if (shadow) {
      styling.shadow = {
        x: shadow.offset?.x || 0,
        y: shadow.offset?.y || 0,
        blur: shadow.radius || 0,
        color: shadow.color || { r: 0, g: 0, b: 0, a: 0.25 }
      };
    }
  }
  
  return styling;
}

function determineInteractionType(name) {
  if (name.includes('button') || name.includes('btn') || name.includes('cta')) {
    return 'button';
  } else if (name.includes('link')) {
    return 'link';
  } else if (name.includes('input') || name.includes('field')) {
    return 'input';
  } else if (name.includes('checkbox')) {
    return 'checkbox';
  } else if (name.includes('radio')) {
    return 'radio';
  } else if (name.includes('toggle') || name.includes('switch')) {
    return 'toggle';
  } else if (name.includes('dropdown') || name.includes('select')) {
    return 'dropdown';
  }
  
  return 'interactive';
}

function groupByComponent(interactives) {
  const grouped = {};
  
  interactives.forEach(element => {
    const key = element.componentId || element.name.replace(/\s+(hover|active|focus|disabled).*$/i, '');
    
    if (!grouped[key]) {
      grouped[key] = {
        baseComponent: key,
        elements: [],
        states: {
          default: null,
          hover: null,
          active: null,
          focus: null,
          disabled: null
        }
      };
    }
    
    grouped[key].elements.push(element);
    
    // Try to identify which state this element represents
    Object.keys(grouped[key].states).forEach(state => {
      if (element.states[state] && state !== 'default') {
        grouped[key].states[state] = element;
      } else if (state === 'default' && Object.values(element.states).filter(Boolean).length === 1) {
        grouped[key].states.default = element;
      }
    });
  });
  
  return grouped;
}

function generateInteractionCSS(groupedElements) {
  const css = {};
  
  Object.entries(groupedElements).forEach(([componentKey, group]) => {
    const className = `.${componentKey.toLowerCase().replace(/\s+/g, '-')}`;
    css[className] = {};
    
    // Default state
    if (group.states.default) {
      css[className] = convertStylingToCSS(group.states.default.styling);
    }
    
    // Hover state
    if (group.states.hover) {
      css[`${className}:hover`] = convertStylingToCSS(group.states.hover.styling);
    } else if (group.states.default) {
      // Generate hover state if not provided
      css[`${className}:hover`] = generateHoverState(group.states.default.styling);
    }
    
    // Active state
    if (group.states.active) {
      css[`${className}:active`] = convertStylingToCSS(group.states.active.styling);
    }
    
    // Focus state
    if (group.states.focus) {
      css[`${className}:focus`] = convertStylingToCSS(group.states.focus.styling);
    } else {
      // Default focus ring
      css[`${className}:focus`] = {
        outline: '2px solid #3b82f6',
        outlineOffset: '2px'
      };
    }
    
    // Disabled state
    if (group.states.disabled) {
      css[`${className}:disabled`] = convertStylingToCSS(group.states.disabled.styling);
    }
  });
  
  return css;
}

function convertStylingToCSS(styling) {
  const css = {};
  
  if (styling.backgroundColor) {
    const { r, g, b, alpha } = styling.backgroundColor;
    css.backgroundColor = alpha < 1 ? 
      `rgba(${r}, ${g}, ${b}, ${alpha})` : 
      `rgb(${r}, ${g}, ${b})`;
  }
  
  if (styling.border) {
    const { width, color } = styling.border;
    const { r, g, b, alpha } = color;
    css.border = `${width}px solid ${alpha < 1 ? 
      `rgba(${r}, ${g}, ${b}, ${alpha})` : 
      `rgb(${r}, ${g}, ${b})`}`;
  }
  
  if (styling.borderRadius !== undefined) {
    css.borderRadius = `${styling.borderRadius}px`;
  }
  
  if (styling.shadow) {
    const { x, y, blur, color } = styling.shadow;
    const { r, g, b, a } = color;
    css.boxShadow = `${x}px ${y}px ${blur}px rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
  }
  
  // Add transition for smooth interactions
  css.transition = 'all 0.2s ease-in-out';
  
  return css;
}

function generateHoverState(baseStyling) {
  const hoverCSS = {};
  
  // Slightly darken or lighten the background
  if (baseStyling.backgroundColor) {
    const { r, g, b, alpha } = baseStyling.backgroundColor;
    const factor = r + g + b > 384 ? 0.9 : 1.1; // Darken light colors, lighten dark colors
    hoverCSS.backgroundColor = alpha < 1 ? 
      `rgba(${Math.round(r * factor)}, ${Math.round(g * factor)}, ${Math.round(b * factor)}, ${alpha})` : 
      `rgb(${Math.round(r * factor)}, ${Math.round(g * factor)}, ${Math.round(b * factor)})`;
  }
  
  // Add subtle scale or shadow effect
  hoverCSS.transform = 'translateY(-1px)';
  if (baseStyling.shadow) {
    hoverCSS.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
  }
  
  return hoverCSS;
}

async function extractInteractionStates() {
  try {
    console.log('✨ Extracting interaction states...');
    
    // Get file data
    const fileData = await makeRequest(`/v1/files/${FILE_KEY}`);
    
    // Find interactive elements
    const interactiveElements = identifyInteractiveElements(fileData.document);
    console.log(`🎯 Found ${interactiveElements.length} interactive elements`);
    
    // Group by component/state
    const groupedElements = groupByComponent(interactiveElements);
    console.log(`🧩 Grouped into ${Object.keys(groupedElements).length} component groups`);
    
    // Generate CSS for interactions
    const interactionCSS = generateInteractionCSS(groupedElements);
    
    // Generate Tailwind classes
    const tailwindInteractions = generateTailwindInteractions(groupedElements);
    
    const outputData = {
      extractedAt: new Date().toISOString(),
      fileKey: FILE_KEY,
      interactiveElements: interactiveElements,
      groupedByComponent: groupedElements,
      generatedCSS: interactionCSS,
      tailwindClasses: tailwindInteractions,
      recommendations: generateInteractionRecommendations(interactiveElements)
    };
    
    // Save interaction data
    const filesDir = path.join(__dirname, '../files');
    if (!fs.existsSync(filesDir)) {
      fs.mkdirSync(filesDir, { recursive: true });
    }
    
    const outputPath = path.join(filesDir, 'interaction-states.json');
    fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
    
    console.log(`✅ Interaction states saved to: ${outputPath}`);
    
    // Print summary
    console.log('\n📊 Interaction Summary:');
    Object.entries(groupedElements).forEach(([component, group]) => {
      const stateCount = Object.values(group.states).filter(Boolean).length;
      console.log(`   ${component}: ${stateCount} states defined`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

function generateTailwindInteractions(groupedElements) {
  const tailwind = {};
  
  Object.entries(groupedElements).forEach(([componentKey, group]) => {
    const className = componentKey.toLowerCase().replace(/\s+/g, '-');
    tailwind[className] = {
      base: 'transition-all duration-200 ease-in-out',
      hover: 'hover:shadow-lg hover:-translate-y-0.5',
      active: 'active:scale-95',
      focus: 'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
      disabled: 'disabled:opacity-50 disabled:cursor-not-allowed'
    };
  });
  
  return tailwind;
}

function generateInteractionRecommendations(interactiveElements) {
  const recommendations = [];
  
  const stateVariations = {};
  interactiveElements.forEach(element => {
    const baseName = element.name.replace(/\s+(hover|active|focus|disabled).*$/i, '');
    if (!stateVariations[baseName]) {
      stateVariations[baseName] = [];
    }
    stateVariations[baseName].push(element);
  });
  
  Object.entries(stateVariations).forEach(([baseName, variations]) => {
    if (variations.length === 1) {
      recommendations.push({
        type: 'suggestion',
        message: `Consider creating hover and focus states for "${baseName}"`,
        component: baseName,
        priority: 'medium'
      });
    }
  });
  
  const buttonCount = interactiveElements.filter(el => 
    el.interactionType === 'button'
  ).length;
  
  if (buttonCount > 0) {
    recommendations.push({
      type: 'info',
      message: `Found ${buttonCount} buttons. Ensure all have proper focus states for accessibility.`,
      priority: 'high'
    });
  }
  
  return recommendations;
}

extractInteractionStates();