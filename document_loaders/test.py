from langchain_community.document_loaders import TextLoader

data = TextLoader("document_loaders/notes.txt")
# print(data)

docs  =  data.load()
# print(docs)