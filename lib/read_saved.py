"""Return literal cells from saved Excel; read-only, with no recalculation or save."""
import sys,json,openpyxl
book=openpyxl.load_workbook(sys.argv[1],read_only=True,data_only=False)
out={}
for ws in book.worksheets:
 cells=[]
 for row in ws.iter_rows(min_row=1,max_row=100,min_col=1,max_col=21):
  for cell in row:
   if cell.data_type!='f' and hasattr(cell,'coordinate'):
    v=cell.value
    if v is not None and not isinstance(v,(str,float,int,bool)): v=str(v)
    cells.append([cell.coordinate,v])
 out[ws.title]=cells
book.close()
print(json.dumps(out,ensure_ascii=False))
