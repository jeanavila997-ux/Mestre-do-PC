// O contexto do usuário entra só em argv. Este texto nunca é interpolado.
export const ANALISAR_PRINT_SCRIPT = `
import sys, os, json, winreg
try:
    k = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Environment")
    key = winreg.QueryValueEx(k, "TYPESAFE_API_KEY")[0]
    os.environ["TYPESAFE_API_KEY"] = key
except Exception:
    pass

from PIL import Image as PILImage
from typesafe_sdk import Choice, Noul, Image, TypeSafeClient

img_path = sys.argv[1]
contexto = sys.argv[2] if len(sys.argv) > 2 else ""
img = PILImage.open(img_path)
w, h = img.size
if min(w, h) < 280:
    canvas = PILImage.new("RGB", (512, 512), (255, 255, 255))
    img = img.convert("RGBA")
    canvas.paste(img, ((512 - w) // 2, (512 - h) // 2), img)
    img = canvas

instrucao = "Classifique o erro visível na imagem \`print\`. Considere o contexto: " + contexto
with TypeSafeClient(
    model="jev-1.14.0",
    headers={"TypeSafe-Danger-Zone-Images": "true"},
    timeout=60,
    retry=None,
) as client:
    questions = {
        "categoria": Choice(
            instructions=instrucao,
            criteria={
                "bsod": "Tela azul da morte (BSOD) com código de parada.",
                "driver": "Erro de driver de vídeo/Geforce/NVIDIA/AMD.",
                "instalador": "Assistente de instalação (wizard, próximo, concluir).",
                "update": "Tela de Windows Update (baixando, instalando, reiniciar).",
                "dialogo": "Diálogo de erro/confirmação/permissão (UAC, app crash).",
                "outro": "Nenhum dos acima (desktop normal, app rodando, etc.)."
            },
        ),
        "dialogo_aberto": Noul(
            instructions="Há um diálogo de erro, confirmação ou UAC aberto na imagem \`print\`?"
        ),
    }
    resp = client.system_one(
        state={"print": Image(img)},
        questions=questions,
    )

choice = resp.choices.get("categoria")
noul = resp.nouls.get("dialogo_aberto")
result = {
    "categoria": choice.choice if choice else "erro",
    "confianca_categoria": choice.confidence if choice else 0,
    "probabilidades": choice.probabilities if choice else {},
    "dialogo_aberto": noul.noul if noul else None,
    "usage": {"input": resp.usage.input_tokens, "output": resp.usage.output_tokens}
}
print(json.dumps(result, ensure_ascii=False))
`;

export function analisarPrintInvocation(python, imagePath, contexto) {
  return {
    command: python,
    args: ["-c", ANALISAR_PRINT_SCRIPT, String(imagePath), String(contexto ?? "")],
  };
}
