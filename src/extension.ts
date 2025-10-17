import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';

class AIProjectGenerator {
  private anthropic: Anthropic;

  constructor() {
    const config = vscode.workspace.getConfiguration('aiCodeGen');
    const apiKey = config.get<string>('claudeApiKey') || '';
    this.anthropic = new Anthropic({ apiKey });
  }

  async generateProject(projectType: string, description: string) {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) {
      throw new Error('Please open a workspace folder first');
    }

    // Generate project name from description
    const projectName = description.split(' ').slice(0, 3).join('-').toLowerCase().replace(/[^a-z0-9-]/g, '');
    const projectPath = path.join(workspace.uri.fsPath, projectName);

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Generating ${projectName}`,
      cancellable: false
    }, async (progress) => {
      
      progress.report({ increment: 30, message: "Asking AI to create project structure..." });
      
      // Use Claude to generate the ENTIRE project
      const projectFiles = await this.generateWithClaude(projectType, description);
      
      progress.report({ increment: 60, message: "Creating files..." });
      
      // Create all files
      await this.createProjectFiles(projectPath, projectFiles);
      
      progress.report({ increment: 100, message: "Complete!" });
    });

    // Offer to open or install
    const action = await vscode.window.showInformationMessage(
      `Project "${projectName}" created successfully!`,
      'Open in New Window',
      'Install Dependencies'
    );

    if (action === 'Open in New Window') {
      await vscode.commands.executeCommand('vscode.openFolder', 
        vscode.Uri.file(projectPath), true
      );
    } else if (action === 'Install Dependencies') {
      const terminal = vscode.window.createTerminal({
        name: 'Install',
        cwd: projectPath
      });
      terminal.sendText('npm install');
      terminal.show();
    }
  }

  private async generateWithClaude(projectType: string, description: string): Promise<Map<string, string>> {
    const systemPrompt = `You are an expert full-stack developer. Generate complete, production-ready project structures.`;
    
    const userPrompt = `Create a complete ${projectType} project with the following:
    
    Description: ${description}
    
    Generate a complete file structure as JSON where:
    - Keys are file paths (e.g., "src/app/page.tsx", "package.json")
    - Values are the complete file contents
    
    Include:
    - All necessary source files
    - package.json with all dependencies
    - Configuration files (tsconfig, etc.)
    - Components, API routes, utilities
    - Styling (Tailwind or CSS)
    - Any authentication, database, or other features mentioned
    
    Make it modern, using Next.js 14+ App Router if it's a web app.
    Return ONLY valid JSON, no markdown or explanations.`;

    const response = await this.anthropic.messages.create({
      model: "claude-3-sonnet-20240229",
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{
        role: "user",
        content: userPrompt
      }]
    });

    // Parse the response
    const content = response.content[0].text;
    
    try {
      // Try to extract JSON if it's wrapped in markdown
      let jsonStr = content;
      if (content.includes('```')) {
        const match = content.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
        if (match) jsonStr = match[1];
      }
      
      const files = JSON.parse(jsonStr);
      return new Map(Object.entries(files));
    } catch (error) {
      // If parsing fails, create a basic structure
      vscode.window.showWarningMessage('Could not parse AI response, creating basic structure');
      return this.createBasicStructure(projectType, description);
    }
  }

  private async createProjectFiles(projectPath: string, files: Map<string, string>) {
    await fs.mkdir(projectPath, { recursive: true });
    
    for (const [filePath, content] of files) {
      const fullPath = path.join(projectPath, filePath);
      const dir = path.dirname(fullPath);
      
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(fullPath, content, 'utf8');
    }
  }

  private createBasicStructure(projectType: string, description: string): Map<string, string> {
    // Fallback basic structure
    const files = new Map<string, string>();
    
    files.set('package.json', JSON.stringify({
      name: "generated-project",
      version: "1.0.0",
      scripts: {
        dev: "next dev",
        build: "next build",
        start: "next start"
      },
      dependencies: {
        next: "14.2.0",
        react: "^18.3.0",
        "react-dom": "^18.3.0"
      }
    }, null, 2));
    
    files.set('app/page.tsx', `export default function Home() {
  return (
    <main>
      <h1>${projectType}</h1>
      <p>${description}</p>
    </main>
  )
}`);
    
    return files;
  }
}

class SidebarProvider implements vscode.WebviewViewProvider {
  private generator: AIProjectGenerator;

  constructor() {
    this.generator = new AIProjectGenerator();
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = { enableScripts: true };
    
    webviewView.webview.html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
            padding: 20px; 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
          }
          h2 {
            font-size: 20px;
            margin-bottom: 20px;
            font-weight: 400;
          }
          .project-types {
            display: grid;
            gap: 10px;
            margin-bottom: 20px;
          }
          .project-type {
            padding: 12px;
            background: var(--vscode-button-secondaryBackground);
            border: 2px solid transparent;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.2s;
          }
          .project-type:hover {
            background: var(--vscode-button-secondaryHoverBackground);
          }
          .project-type.selected {
            border-color: var(--vscode-focusBorder);
            background: var(--vscode-list-activeSelectionBackground);
          }
          .project-type h3 {
            font-size: 14px;
            margin-bottom: 4px;
          }
          .project-type p {
            font-size: 12px;
            opacity: 0.8;
          }
          textarea {
            width: 100%;
            padding: 12px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-family: inherit;
            font-size: 13px;
            resize: vertical;
            min-height: 100px;
          }
          textarea:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
          }
          button {
            width: 100%;
            padding: 12px;
            margin-top: 20px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            font-size: 14px;
            cursor: pointer;
            transition: background 0.2s;
          }
          button:hover {
            background: var(--vscode-button-hoverBackground);
          }
          button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
        </style>
      </head>
      <body>
        <h2>Hello! What project would you like to code today?</h2>
        
        <div class="project-types">
          <div class="project-type" data-type="Website">
            <h3>🌐 Website</h3>
            <p>Full-stack web application</p>
          </div>
          <div class="project-type" data-type="API">
            <h3>🔌 API</h3>
            <p>REST or GraphQL backend</p>
          </div>
          <div class="project-type" data-type="GPT Agent">
            <h3>🤖 GPT Agent</h3>
            <p>AI-powered application</p>
          </div>
          <div class="project-type" data-type="Mobile App">
            <h3>📱 Mobile App</h3>
            <p>React Native application</p>
          </div>
          <div class="project-type" data-type="Chrome Extension">
            <h3>🧩 Chrome Extension</h3>
            <p>Browser extension</p>
          </div>
          <div class="project-type" data-type="CLI Tool">
            <h3>⌨️ CLI Tool</h3>
            <p>Command-line application</p>
          </div>
        </div>
        
        <textarea id="description" 
                  placeholder="Describe what you want to build...&#10;&#10;Be specific! For example:&#10;'E-commerce site with user auth using Kinde, product listings, shopping cart, and Stripe payments'&#10;&#10;or&#10;&#10;'AI chatbot using OpenAI that can answer questions about uploaded documents'"></textarea>
        
        <button id="generateBtn" onclick="generate()">Generate Project ✨</button>
        
        <script>
          const vscode = acquireVsCodeApi();
          let selectedType = null;
          
          // Handle project type selection
          document.querySelectorAll('.project-type').forEach(el => {
            el.addEventListener('click', () => {
              document.querySelectorAll('.project-type').forEach(t => 
                t.classList.remove('selected')
              );
              el.classList.add('selected');
              selectedType = el.dataset.type;
            });
          });
          
          function generate() {
            const description = document.getElementById('description').value;
            
            if (!selectedType) {
              vscode.postMessage({
                command: 'error',
                message: 'Please select a project type'
              });
              return;
            }
            
            if (!description) {
              vscode.postMessage({
                command: 'error',
                message: 'Please describe your project'
              });
              return;
            }
            
            const btn = document.getElementById('generateBtn');
            btn.disabled = true;
            btn.textContent = 'Generating...';
            
            vscode.postMessage({
              command: 'generate',
              projectType: selectedType,
              description: description
            });
            
            // Reset after a delay
            setTimeout(() => {
              btn.disabled = false;
              btn.textContent = 'Generate Project ✨';
            }, 5000);
          }
        </script>
      </body>
      </html>
    `;

    webviewView.webview.onDidReceiveMessage(async (data) => {
      if (data.command === 'generate') {
        try {
          await this.generator.generateProject(data.projectType, data.description);
        } catch (error: any) {
          vscode.window.showErrorMessage(error.message);
        }
      } else if (data.command === 'error') {
        vscode.window.showWarningMessage(data.message);
      }
    });
  }
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new SidebarProvider();
  
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('aiCodeGen.sidebar', provider)
  );
}

export function deactivate() {}