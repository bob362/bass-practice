#!/usr/bin/env python3
"""
ベースタブのサンプルPDFを生成するスクリプト
reportlabを使用してPDFを作成
"""

try:
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas
    from reportlab.lib.units import inch
except ImportError:
    print("reportlabがインストールされていません。インストールします...")
    import subprocess
    subprocess.check_call(['pip3', 'install', 'reportlab'])
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas
    from reportlab.lib.units import inch

def create_bass_tab_pdf(filename):
    """ベースタブのサンプルPDFを作成"""
    c = canvas.Canvas(filename, pagesize=letter)
    width, height = letter
    
    # タイトル
    c.setFont("Helvetica-Bold", 20)
    c.drawString(1*inch, height - 1*inch, "Sample Bass Tab")
    
    c.setFont("Helvetica", 12)
    c.drawString(1*inch, height - 1.3*inch, "Artist: Demo Band")
    c.drawString(1*inch, height - 1.5*inch, "Tempo: 120 BPM")
    c.drawString(1*inch, height - 1.7*inch, "Tuning: Standard (E A D G)")
    
    # タブ譜を描画
    y_start = height - 2.5*inch
    
    # セクション1
    draw_bass_tab_section(c, 1*inch, y_start,
        "G|---5---7---9---7---|",
        "D|-5---7---9---7-----|",
        "A|-------------------|",
        "E|-------------------|"
    )
    
    # セクション2
    y_start -= 1.2*inch
    draw_bass_tab_section(c, 1*inch, y_start,
        "G|-------------------|",
        "D|---5---7---9---7---|",
        "A|-5---7---9---7-----|",
        "E|-------------------|"
    )
    
    # セクション3
    y_start -= 1.2*inch
    draw_bass_tab_section(c, 1*inch, y_start,
        "G|-------------------|",
        "D|-------------------|",
        "A|---5---7---9---7---|",
        "E|-0---3---5---7-----|"
    )
    
    # セクション4
    y_start -= 1.2*inch
    draw_bass_tab_section(c, 1*inch, y_start,
        "G|-7-7-9-9-10-10-12-|",
        "D|-------------------|",
        "A|-------------------|",
        "E|-------------------|"
    )
    
    # フッター
    c.setFont("Helvetica", 8)
    c.drawString(1*inch, 0.5*inch, "Generated for Bass Practice App - PDF Import Demo")
    
    c.save()
    print(f"PDFを作成しました: {filename}")

def draw_bass_tab_section(c, x, y, line_g, line_d, line_a, line_e):
    """4行のベースタブを描画"""
    c.setFont("Courier", 11)
    line_height = 15
    
    c.drawString(x, y, line_g)
    c.drawString(x, y - line_height, line_d)
    c.drawString(x, y - line_height*2, line_a)
    c.drawString(x, y - line_height*3, line_e)

if __name__ == "__main__":
    create_bass_tab_pdf("public/sample-bass-tab.pdf")
